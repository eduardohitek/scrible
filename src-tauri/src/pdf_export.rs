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

/// Windows e Linux (#81): sem `createPDF`, cada motor imprime para PDF pela
/// própria API (WebView2 `PrintToPdf`, `WebKitPrintOperation`). O HTML vai
/// para um arquivo temporário carregado por URL `file://` numa janela oculta
/// — `NavigateToString` do WebView2 corta em 2 MB, e um documento com vários
/// diagramas mermaid em SVG passa disso fácil. O fim do load vem de
/// `on_page_load`, sem delegate nativo. Como no macOS, tudo é `.await`: o
/// callback de cada motor só chega se o loop de eventos nativo puder rodar.
#[cfg(not(target_os = "macos"))]
mod portable {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use tauri::webview::PageLoadEvent;
    use tauri::{AppHandle, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
    use tokio::sync::oneshot;

    use super::PdfExportError;

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);
    const LOAD_TIMEOUT: Duration = Duration::from_secs(30);
    const PRINT_TIMEOUT: Duration = Duration::from_secs(60);

    /// Apaga os arquivos temporários ao sair de escopo, inclusive nos erros.
    struct TempFiles(Vec<PathBuf>);

    impl Drop for TempFiles {
        fn drop(&mut self) {
            for path in &self.0 {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    pub async fn render_html_to_pdf(app: &AppHandle, html: String) -> Result<Vec<u8>, PdfExportError> {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let stem = format!("scrible-pdf-export-{}-{id}", std::process::id());
        let html_path = std::env::temp_dir().join(format!("{stem}.html"));
        let pdf_path = std::env::temp_dir().join(format!("{stem}.pdf"));
        let _cleanup = TempFiles(vec![html_path.clone(), pdf_path.clone()]);
        std::fs::write(&html_path, html)?;
        let url = Url::from_file_path(&html_path)
            .map_err(|_| PdfExportError::native("caminho temporário inválido"))?;

        let (loaded_tx, loaded_rx) = oneshot::channel::<()>();
        let loaded_tx = Mutex::new(Some(loaded_tx));
        let window = WebviewWindowBuilder::new(app, format!("pdf-export-{id}"), WebviewUrl::External(url))
            .visible(false)
            .on_page_load(move |_, payload| {
                if payload.event() == PageLoadEvent::Finished {
                    if let Some(tx) = loaded_tx.lock().unwrap().take() {
                        let _ = tx.send(());
                    }
                }
            })
            .build()
            .map_err(|err| PdfExportError::native(err.to_string()))?;

        let result = match tokio::time::timeout(LOAD_TIMEOUT, loaded_rx).await {
            Ok(Ok(())) => match tokio::time::timeout(PRINT_TIMEOUT, print_to_pdf(&window, &pdf_path)).await {
                Ok(Ok(())) => std::fs::read(&pdf_path).map_err(PdfExportError::from),
                Ok(Err(err)) => Err(err),
                Err(_) => Err(PdfExportError::native("tempo esgotado gerando o PDF")),
            },
            Ok(Err(_)) => Err(PdfExportError::native("janela de exportação fechada antes do load")),
            Err(_) => Err(PdfExportError::native("tempo esgotado carregando o documento")),
        };

        // `destroy()`, não `close()`: ver o comentário do módulo macOS.
        let _ = window.destroy();
        result
    }

    type Done = Arc<Mutex<Option<oneshot::Sender<Result<(), String>>>>>;

    fn finish(done: &Done, result: Result<(), String>) {
        if let Some(tx) = done.lock().unwrap().take() {
            let _ = tx.send(result);
        }
    }

    async fn print_to_pdf(window: &WebviewWindow, out: &Path) -> Result<(), PdfExportError> {
        let (tx, rx) = oneshot::channel();
        let done: Done = Arc::new(Mutex::new(Some(tx)));
        let started = start_print(window, out.to_path_buf(), done.clone());
        if let Err(err) = started {
            return Err(PdfExportError::native(err.to_string()));
        }
        match rx.await {
            Ok(result) => result.map_err(PdfExportError::native),
            Err(_) => Err(PdfExportError::native("impressão encerrada sem resposta")),
        }
    }

    /// WebView2: `PrintToPdf` grava direto no caminho e avisa pelo handler.
    /// Página A4 (8,27 × 11,69 pol.) com fundos, como o `createPDF` do macOS.
    #[cfg(windows)]
    fn start_print(window: &WebviewWindow, out: PathBuf, done: Done) -> tauri::Result<()> {
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7};
        use webview2_com::PrintToPdfCompletedHandler;
        use windows_core::{Interface, PCWSTR};

        window.with_webview(move |webview| {
            let started = (|| -> windows_core::Result<()> {
                unsafe {
                    let core: ICoreWebView2_7 = webview.controller().CoreWebView2()?.cast()?;
                    let env: ICoreWebView2Environment6 = webview.environment().cast()?;
                    let settings = env.CreatePrintSettings()?;
                    settings.SetShouldPrintBackgrounds(true)?;
                    settings.SetPageWidth(8.27)?;
                    settings.SetPageHeight(11.69)?;
                    let handler_done = done.clone();
                    let handler = PrintToPdfCompletedHandler::create(Box::new(move |status, ok| {
                        let result = match status {
                            Err(err) => Err(err.to_string()),
                            Ok(()) if !ok => Err("PrintToPdf retornou sem sucesso".to_string()),
                            Ok(()) => Ok(()),
                        };
                        finish(&handler_done, result);
                        Ok(())
                    }));
                    let wide: Vec<u16> = out.to_string_lossy().encode_utf16().chain(Some(0)).collect();
                    core.PrintToPdf(PCWSTR(wide.as_ptr()), &settings, &handler)
                }
            })();
            if let Err(err) = started {
                finish(&done, Err(err.to_string()));
            }
        })
    }

    /// WebKitGTK: operação de impressão para a "impressora" de arquivo, sem
    /// diálogo (`print()` usa as configurações como estão).
    #[cfg(target_os = "linux")]
    fn start_print(window: &WebviewWindow, out: PathBuf, done: Done) -> tauri::Result<()> {
        use std::cell::RefCell;
        use std::rc::Rc;

        use webkit2gtk::{PrintOperation, PrintOperationExt};

        window.with_webview(move |webview| {
            let Ok(uri) = Url::from_file_path(&out) else {
                finish(&done, Err("caminho temporário inválido".to_string()));
                return;
            };
            let settings = gtk::PrintSettings::new();
            // O GTK traduz o nome da impressora virtual (domínio `gtk30`), e o
            // WebKit a procura pelo nome traduzido: em pt-BR "Print to File"
            // sozinho dá "Printer not found". `dgettext` devolve o mesmo
            // texto que o GTK usa; sem tradução, volta o msgid em inglês.
            settings.set_printer(&gtk::glib::dgettext(Some("gtk30"), "Print to File"));
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(uri.as_str()));
            let page = gtk::PageSetup::new();
            page.set_paper_size(&gtk::PaperSize::new(Some("iso_a4")));

            let operation = PrintOperation::new(&webview.inner());
            operation.set_print_settings(&settings);
            operation.set_page_setup(&page);

            // A operação se mantém viva até terminar; o `Rc` quebra o ciclo
            // handler → operação ao ser esvaziado no fim.
            let keep_alive = Rc::new(RefCell::new(Some(operation.clone())));
            let finished_done = done.clone();
            let finished_keep = keep_alive.clone();
            operation.connect_finished(move |_| {
                finish(&finished_done, Ok(()));
                finished_keep.borrow_mut().take();
            });
            operation.connect_failed(move |_, err| {
                finish(&done, Err(err.to_string()));
                keep_alive.borrow_mut().take();
            });
            operation.print();
        })
    }
}

#[cfg(not(target_os = "macos"))]
pub use portable::render_html_to_pdf;
