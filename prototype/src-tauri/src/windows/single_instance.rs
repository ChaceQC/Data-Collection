#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum SingleInstanceRequest {
    Focus,
    Import(Vec<String>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SingleInstanceInputError {
    InvalidPaths,
}

pub(crate) fn classify_args(
    args: &[String],
) -> Result<SingleInstanceRequest, SingleInstanceInputError> {
    let paths = args.iter().skip(1).cloned().collect::<Vec<_>>();
    if paths.is_empty() || (paths.len() == 1 && paths[0] == "--show") {
        return Ok(SingleInstanceRequest::Focus);
    }
    crate::filesystem::validate_scan_paths(&paths)
        .map_err(|_| SingleInstanceInputError::InvalidPaths)?;
    Ok(SingleInstanceRequest::Import(paths))
}

#[cfg(not(test))]
pub(crate) fn handle<R: tauri::Runtime>(app: &tauri::AppHandle<R>, args: Vec<String>) {
    if let Err(error) = super::lifecycle::show_main_window(app) {
        let _ = tauri::Emitter::emit_to(app, "main", "single-instance-error", error);
        return;
    }

    match classify_args(&args) {
        Ok(SingleInstanceRequest::Focus) => {}
        Ok(SingleInstanceRequest::Import(paths)) => {
            let app_for_task = app.clone();
            tauri::async_runtime::spawn(async move {
                match crate::commands::index_paths_from_single_instance(paths, app_for_task.clone())
                    .await
                {
                    Ok(result) => {
                        let _ = tauri::Emitter::emit_to(
                            &app_for_task,
                            "main",
                            "single-instance-imported",
                            result,
                        );
                    }
                    Err(_) => {
                        let _ = tauri::Emitter::emit_to(
                            &app_for_task,
                            "main",
                            "single-instance-error",
                            "第二个实例的文件参数无法处理，请使用导入入口",
                        );
                    }
                }
            });
        }
        Err(SingleInstanceInputError::InvalidPaths) => {
            let _ = tauri::Emitter::emit_to(
                app,
                "main",
                "single-instance-error",
                "第二个实例的文件参数超出安全上限，请使用导入入口",
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_args, SingleInstanceInputError, SingleInstanceRequest};

    #[test]
    fn focuses_existing_instance_without_extra_arguments() {
        assert_eq!(
            classify_args(&["workbench.exe".to_string()]),
            Ok(SingleInstanceRequest::Focus)
        );
    }

    #[test]
    fn forwards_bounded_file_arguments_as_an_import_request() {
        let args = vec![
            "workbench.exe".to_string(),
            r"E:\测试资料\研究 计划.md".to_string(),
            r"E:\测试资料\访谈.txt".to_string(),
        ];
        assert_eq!(
            classify_args(&args),
            Ok(SingleInstanceRequest::Import(args[1..].to_vec()))
        );
    }

    #[test]
    fn treats_the_explicit_show_flag_as_a_focus_request() {
        assert_eq!(
            classify_args(&["workbench.exe".to_string(), "--show".to_string()]),
            Ok(SingleInstanceRequest::Focus)
        );
    }

    #[test]
    fn rejects_over_limit_file_arguments_before_the_import_pipeline() {
        let args = vec!["workbench.exe".to_string(); 258];
        assert_eq!(
            classify_args(&args),
            Err(SingleInstanceInputError::InvalidPaths)
        );
    }
}
