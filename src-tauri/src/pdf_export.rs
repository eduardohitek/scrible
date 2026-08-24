use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind")]
pub enum PdfExportError {
    #[error("falha nativa ao gerar PDF: {message}")]
    Native { message: String },
    #[error("falha de I/O: {message}")]
    Io { message: String },
}

impl PdfExportError {
    fn native(message: impl Into<String>) -> Self {
        PdfExportError::Native {
            message: message.into(),
        }
    }
}

impl From<std::io::Error> for PdfExportError {
    fn from(err: std::io::Error) -> Self {
        PdfExportError::Io {
            message: err.to_string(),
        }
    }
}

/// Gera bytes de PDF a partir de `html` (#27), via `WKWebView.createPDF()`
/// (macOS 11+) — a mesma API nativa por trás de "Exportar como PDF" no
/// Safari. Rota escolhida depois de confirmar, na verificação manual, que
/// `window.print()` não faz nada no WKWebView do Tauri/wry: não há
/// `WKUIDelegate` de impressão instalado, limitação conhecida upstream
/// (github.com/tauri-apps/wry#707). `createPDF` evita esse problema por
/// completo — não depende do painel de impressão do SO — e evita duplicar
/// o pipeline de renderização de markdown/mermaid em outro motor (ex:
/// wkhtmltopdf), como a própria issue pede.
#[cfg(target_os = "macos")]
mod macos {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2_foundation::{NSData, NSError, NSString};
    use objc2_web_kit::{WKPDFConfiguration, WKWebView};
    use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
    use tokio::sync::oneshot;

    use super::PdfExportError;

    static NEXT_WINDOW_ID: AtomicU64 = AtomicU64::new(0);

    /// Achado na verificação manual: os comandos deste app rodam na mesma
    /// thread do loop de eventos nativo (main thread) — `with_webview`
    /// despacha inline nela. `createPDF` entrega seu resultado via um bloco
    /// ObjC que o WebKit invoca através da fila principal (GCD), e essa fila
    /// só drena quando o loop de eventos nativo consegue rodar de novo. Um
    /// wait *bloqueante* (`std::sync::mpsc::recv_timeout`/`thread::sleep`)
    /// nessa mesma thread trava o loop de eventos por completo — inclusive
    /// impedindo o próprio callback do createPDF de ser entregue, travando o
    /// app inteiro até o timeout (confirmado: o callback só chegava a rodar
    /// *depois* do timeout de 30s, quando finalmente devolvíamos o
    /// controle). `.await` em vez de bloqueio síncrono resolve: cede o
    /// controle de volta pro loop nativo entre os pontos de espera, deixando
    /// o callback do WebKit ser entregue normalmente.
    pub async fn render_html_to_pdf(app: &AppHandle, html: String) -> Result<Vec<u8>, PdfExportError> {
        let id = NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed);
        let label = format!("pdf-export-{id}");

        // Janela oculta dedicada: `createPDF` opera sobre o WKWebView de uma
        // WebviewWindow real (via `with_webview`), não um iframe dentro da
        // janela principal — não competimos por conteúdo/estado com a aba
        // que o usuário está editando.
        let window = WebviewWindowBuilder::new(
            app,
            &label,
            WebviewUrl::External("about:blank".parse().unwrap()),
        )
        .visible(false)
        .build()
        .map_err(|err| PdfExportError::native(err.to_string()))?;

        let load_result = window.with_webview(move |webview| {
            let view: &WKWebView = unsafe { &*webview.inner().cast() };
            let ns_html = NSString::from_str(&html);
            unsafe {
                view.loadHTMLString_baseURL(&ns_html, None);
            }
        });
        if let Err(err) = load_result {
            let _ = window.destroy();
            return Err(PdfExportError::native(err.to_string()));
        }

        // Conteúdo é 100% estático e local (mermaid já resolvido em SVG,
        // CSS embutido, sem fontes/imagens externas) — nenhum recurso
        // assíncrono real a aguardar. Uma pausa fixa curta após o load é
        // suficiente pro WebKit terminar o layout antes do createPDF,
        // evitando a complexidade de implementar um WKNavigationDelegate
        // customizado em objc2 só pra esse sinal. Revisitar se a
        // verificação manual mostrar PDFs incompletos em documentos muito
        // grandes.
        tokio::time::sleep(Duration::from_millis(300)).await;

        let (tx, rx) = oneshot::channel::<Result<Vec<u8>, String>>();
        let pdf_result = window.with_webview(move |webview| {
            let view: &WKWebView = unsafe { &*webview.inner().cast() };
            let config = unsafe { WKPDFConfiguration::new() };
            // `tx` só é enviado uma vez, dentro do bloco ObjC invocado pelo
            // WebKit — envolvido em `Mutex<Option<_>>` porque `RcBlock::new`
            // exige `Fn`, não `FnOnce`, mesmo o completion handler do
            // createPDF disparando só uma vez.
            let tx = Mutex::new(Some(tx));
            let handler = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                let result = if !error.is_null() {
                    Err(format!("{}", unsafe { &*error }.localizedDescription()))
                } else if !data.is_null() {
                    Ok(unsafe { &*data }.bytes().to_vec())
                } else {
                    Err("createPDF retornou sem dados e sem erro".to_string())
                };
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(result);
                }
            });
            unsafe {
                view.createPDFWithConfiguration_completionHandler(Some(&config), &handler);
            }
        });

        let result = match pdf_result {
            Ok(()) => match tokio::time::timeout(Duration::from_secs(30), rx).await {
                Ok(Ok(inner)) => inner.map_err(PdfExportError::native),
                Ok(Err(_)) => Err(PdfExportError::native("canal do createPDF fechado sem resposta")),
                Err(_) => Err(PdfExportError::native("tempo esgotado aguardando createPDF")),
            },
            Err(err) => Err(PdfExportError::native(err.to_string())),
        };

        // `destroy()`, não `close()`: `close()` emite `WindowEvent::CloseRequested`
        // como uma janela real fechada pelo usuário, que o handler global em
        // `lib.rs` intercepta com `prevent_close()` (pensado pro handshake de
        // flush do autosave da janela principal) — nunca destruiria esta
        // janela temporária de export.
        let _ = window.destroy();
        result
    }
}

#[cfg(target_os = "macos")]
pub use macos::render_html_to_pdf;
