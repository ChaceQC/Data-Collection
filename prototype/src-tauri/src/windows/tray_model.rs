#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrayMenuAction {
    OpenMain,
    OpenSettings,
    ToggleFloating,
    Exit,
    OpenTask(String),
    ToggleFavorite(String),
}

#[allow(dead_code)]
pub const TRAY_STATIC_MENU_IDS: [&str; 5] = [
    "tray-open-main",
    "tray-toggle-floating",
    "tray-recent-tasks",
    "tray-open-settings",
    "tray-exit",
];

pub fn parse_menu_id(raw: &str) -> Option<TrayMenuAction> {
    if raw.is_empty() || raw.len() > 160 || raw.chars().any(char::is_control) {
        return None;
    }
    match raw {
        "tray-open-main" => Some(TrayMenuAction::OpenMain),
        "tray-toggle-floating" => Some(TrayMenuAction::ToggleFloating),
        "tray-open-settings" => Some(TrayMenuAction::OpenSettings),
        "tray-exit" => Some(TrayMenuAction::Exit),
        _ => parse_task_id(raw),
    }
}

pub fn sanitize_menu_label(value: &str) -> String {
    const MAX_CHARS: usize = 64;
    let mut normalized = value
        .chars()
        .map(|character| {
            if character.is_control() || character == '\u{00a0}' {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    normalized = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return "未命名资料".to_string();
    }
    let chars = trimmed.chars().collect::<Vec<_>>();
    if chars.len() <= MAX_CHARS {
        return trimmed.to_string();
    }
    format!("{}...", chars[..MAX_CHARS - 3].iter().collect::<String>())
}

pub fn task_label(name: &str, invalid: bool) -> String {
    let label = sanitize_menu_label(name);
    if invalid {
        format!("{label}（路径失效）")
    } else {
        label
    }
}

pub fn favorite_label(favorite: bool) -> &'static str {
    if favorite {
        "取消收藏"
    } else {
        "收藏"
    }
}

fn parse_task_id(raw: &str) -> Option<TrayMenuAction> {
    for (prefix, action) in [("tray-task-open:", false), ("tray-task-favorite:", true)] {
        if let Some(id) = raw.strip_prefix(prefix) {
            if valid_opaque_id(id) {
                return Some(if action {
                    TrayMenuAction::ToggleFavorite(id.to_string())
                } else {
                    TrayMenuAction::OpenTask(id.to_string())
                });
            }
        }
    }
    None
}

fn valid_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && !value.contains(['/', '\\', ':'])
        && !value.contains("..")
        && value
            .chars()
            .all(|character| !character.is_control() && !character.is_whitespace())
}

#[cfg(test)]
mod tests {
    use super::{
        favorite_label, parse_menu_id, sanitize_menu_label, task_label, TrayMenuAction,
        TRAY_STATIC_MENU_IDS,
    };

    #[test]
    fn parses_only_known_static_and_opaque_task_ids() {
        assert_eq!(
            parse_menu_id("tray-task-open:entry-1"),
            Some(TrayMenuAction::OpenTask("entry-1".to_string()))
        );
        assert_eq!(
            parse_menu_id("tray-task-favorite:entry-1"),
            Some(TrayMenuAction::ToggleFavorite("entry-1".to_string()))
        );
        assert_eq!(parse_menu_id("tray-task-open:C:\\secret.txt"), None);
        assert_eq!(parse_menu_id("tray-task-open:"), None);
        assert_eq!(parse_menu_id("unknown"), None);
    }

    #[test]
    fn cleans_and_limits_menu_labels() {
        assert_eq!(sanitize_menu_label("  中文\n资料\t "), "中文 资料");
        assert_eq!(sanitize_menu_label(" \u{0000} "), "未命名资料");
        let long = "a".repeat(80);
        let label = sanitize_menu_label(&long);
        assert_eq!(label.chars().count(), 64);
        assert!(label.ends_with("..."));
        assert_eq!(task_label("失效.txt", true), "失效.txt（路径失效）");
    }

    #[test]
    fn exposes_stable_static_order_and_favorite_labels() {
        assert_eq!(
            TRAY_STATIC_MENU_IDS,
            [
                "tray-open-main",
                "tray-toggle-floating",
                "tray-recent-tasks",
                "tray-open-settings",
                "tray-exit"
            ]
        );
        assert_eq!(favorite_label(false), "收藏");
        assert_eq!(favorite_label(true), "取消收藏");
    }
}
