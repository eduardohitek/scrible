use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Wry};

/// Monta o menu nativo do macOS (#24): Arquivo/Editar/Visualizar/Janela, mais um submenu de app
/// ("scrible") com só o item Sair. Itens customizados (não-`Predefined*`) disparam eventos JS via
/// `on_menu_event`, registrado por quem chamar esta função — aqui só a estrutura é montada.
///
/// O submenu de app é o **primeiro** passado ao `MenuBuilder`: no macOS, o primeiro submenu de um
/// menu principal vira automaticamente o menu de app (com o nome do processo na barra de menu),
/// sem precisar de nenhuma chamada adicional.
pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let quit = MenuItemBuilder::with_id("quit", "Sair")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "scrible").item(&quit).build()?;

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
        .item(&export_html)
        .build()?;

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

    let toggle_preview = MenuItemBuilder::with_id("toggle_preview", "Alternar preview")
        .accelerator("CmdOrCtrl+Shift+P")
        .build(app)?;
    let toggle_explorer = MenuItemBuilder::with_id("toggle_explorer", "Alternar explorador")
        .accelerator("CmdOrCtrl+Shift+E")
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
        .item(&toggle_preview)
        .item(&toggle_explorer)
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
