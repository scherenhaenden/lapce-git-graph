use lapce_plugin::{
    psp_types::{
        lsp_types::{request::Initialize, InitializeParams, MessageType},
        Request,
    },
    register_plugin, LapcePlugin, PLUGIN_RPC,
};
use serde_json::Value;

#[derive(Default)]
struct GitGraphPlugin {}

impl LapcePlugin for GitGraphPlugin {
    fn handle_request(&mut self, _id: u64, method: String, params: Value) {
        if method == Initialize::METHOD {
            if let Ok(_params) = serde_json::from_value::<InitializeParams>(params) {
                let _ = PLUGIN_RPC.window_show_message(
                    MessageType::INFO,
                    "Git Graph plugin initialized for Lapce! Viewer available at http://127.0.0.1:6428".to_string(),
                );
            }
        }
    }

    fn handle_notification(&mut self, method: String, _params: Value) {
        if method == "open_git_graph" || method == "initialize" {
            let _ = PLUGIN_RPC.window_log_message(
                MessageType::INFO,
                "Opening Git Graph viewer...".to_string(),
            );
            let _ = PLUGIN_RPC.execute_process(
                "xdg-open".to_string(),
                vec!["http://127.0.0.1:6428".to_string()],
            );
        }
    }
}

register_plugin!(GitGraphPlugin);
