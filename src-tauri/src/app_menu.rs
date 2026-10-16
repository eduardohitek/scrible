use tauri::menu::{
    AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Wry};

/// Autor usado quando `authors` do `Cargo.toml` estiver vazio.
const FALLBACK_AUTHOR: &str = "Eduardo Hitek";

/// Autores do `Cargo.toml` (`CARGO_PKG_AUTHORS` vem separado por `:`), com fallback fixo.
fn authors(raw: &str) -> Vec<String> {
    let list: Vec<String> = raw
        .split(':')
        .map(str::trim)
        .filter(|a| !a.is_empty())
        .map(String::from)
        .collect();
    if list.is_empty() {
        vec![FALLBACK_AUTHOR.to_string()]
    } else {
        list
    }
}

/// Dados do painel "Sobre o scrible": nome e versão vêm do `package_info` (que o Tauri lê do
/// `package.json` via `tauri.conf.json`), autor do `Cargo.toml`. O painel nativo do macOS ignora
/// `authors`, então o autor também vai em `credits`, o campo que ele exibe.
fn about_metadata(app: &AppHandle) -> AboutMetadata<'_> {
    let info = app.package_info();
    let authors = authors(env!("CARGO_PKG_AUTHORS"));
    AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        credits: Some(format!("Autor: {}", authors.join(", "))),
        authors: Some(authors),
        ..Default::default()
    }
}

/// Monta o menu nativo (#24; igual nas três plataformas, #32): Arquivo/Editar/Visualizar/Janela, mais um submenu de app
/// ("scrible") com "Sobre o scrible", "Procurar atualizações…" e Sair. Itens customizados (não-`Predefined*`) disparam eventos JS via
/// `on_menu_event`, registrado por quem chamar esta função — aqui só a estrutura é montada.
///
/// O submenu de app é o **primeiro** passado ao `MenuBuilder`: no macOS, o primeiro submenu de um
/// menu principal vira automaticamente o menu de app (com o nome do processo na barra de menu),
/// sem precisar de nenhuma chamada adicional.
pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let quit = MenuItemBuilder::with_id("quit", "Sair")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let about = PredefinedMenuItem::about(app, Some("Sobre o scrible"), Some(about_metadata(app)))?;
    let check_updates = MenuItemBuilder::with_id("check_updates", "Procurar atualizações…").build(app)?;
    let app_menu = SubmenuBuilder::new(app, "scrible")
        .item(&about)
        .separator()
        .item(&check_updates)
        .separator()
        .item(&quit)
        .build()?;

    let new_tab = MenuItemBuilder::with_id("new_tab", "Novo")
        .accelerator("CmdOrCtrl+T")
        .build(app)?;
    let open_file = MenuItemBuilder::with_id("open_file", "Abrir arquivo…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let close_tab = MenuItemBuilder::with_id("close_tab", "Fechar aba")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let rename_tab = MenuItemBuilder::with_id("rename_tab", "Renomear").build(app)?;
    let export_html = MenuItemBuilder::with_id("export_html", "Exportar para HTML…").build(app)?;
    let file_menu = SubmenuBuilder::new(app, "Arquivo")
        .item(&new_tab)
        .item(&open_file)
        .separator()
        .item(&close_tab)
        .item(&rename_tab)
        .separator()
        .item(&export_html);
    // PDF só no macOS (#27); Windows/Linux ficam sem o item até o follow-up da #32.
    #[cfg(target_os = "macos")]
    let file_menu = {
        let export_pdf = MenuItemBuilder::with_id("export_pdf", "Exportar para PDF…").build(app)?;
        file_menu.item(&export_pdf)
    };
    let file_menu = file_menu.build()?;

    let find = MenuItemBuilder::with_id("find", "Buscar")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let edit_menu = SubmenuBuilder::new(app, "Editar")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .separator()
        .item(&find)
        .build()?;

    let cycle_view_mode = MenuItemBuilder::with_id("cycle_view_mode", "Alternar modo de exibição")
        .accelerator("CmdOrCtrl+Shift+P")
        .build(app)?;
    let view_editor = MenuItemBuilder::with_id("view_editor", "Editor").build(app)?;
    let view_split = MenuItemBuilder::with_id("view_split", "Lado a lado").build(app)?;
    let view_preview = MenuItemBuilder::with_id("view_preview", "Visualização").build(app)?;
    let view_mode_menu = SubmenuBuilder::new(app, "Modo de exibição")
        .item(&view_editor)
        .item(&view_split)
        .item(&view_preview)
        .build()?;
    let toggle_explorer = MenuItemBuilder::with_id("toggle_explorer", "Alternar explorador")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let zoom_in = MenuItemBuilder::with_id("zoom_in", "Aumentar")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom_out", "Diminuir")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom_reset", "Tamanho original")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let theme_system = MenuItemBuilder::with_id("theme_system", "Sistema").build(app)?;
    let theme_light = MenuItemBuilder::with_id("theme_light", "Claro").build(app)?;
    let theme_dark = MenuItemBuilder::with_id("theme_dark", "Escuro").build(app)?;
    let theme_menu = SubmenuBuilder::new(app, "Tema")
        .item(&theme_system)
        .item(&theme_light)
        .item(&theme_dark)
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "Visualizar")
        .item(&cycle_view_mode)
        .item(&view_mode_menu)
        .item(&toggle_explorer)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .separator()
        .item(&theme_menu)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Janela")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authors_le_lista_do_cargo() {
        assert_eq!(authors("Eduardo Hitek"), vec!["Eduardo Hitek"]);
        assert_eq!(authors("A <a@x>:B"), vec!["A <a@x>", "B"]);
    }

    #[test]
    fn authors_vazio_cai_no_fallback() {
        assert_eq!(authors(""), vec![FALLBACK_AUTHOR]);
        assert_eq!(authors(" : "), vec![FALLBACK_AUTHOR]);
    }
}
