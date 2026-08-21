fn main() {
    if let Ok(target) = std::env::var("TARGET") {
        println!("cargo:rustc-env=DESKTOP_TARGET={target}");
    }
    if std::env::var_os("CARGO_FEATURE_DESKTOP").is_some() {
        tauri_build::build()
    }
}
