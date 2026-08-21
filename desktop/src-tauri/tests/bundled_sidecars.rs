#[cfg(all(windows, feature = "desktop"))]
#[test]
fn tauri_app_launches_every_registered_windows_sidecar() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_rna-seq-local-desktop"))
        .arg("--verify-bundled-sidecars")
        .output()
        .expect("the Tauri application binary should start");
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.status.success(),
        "the Tauri application did not verify its bundled sidecars:\n{combined}"
    );
    for expected in [
        "Fastp\t0.23.4",
        "Kallisto\t0.52.0",
        "Hisat2\t2.2.3",
        "Hisat2Build\t2.2.3",
        "FeatureCounts\t2.1.1",
    ] {
        assert!(
            combined.contains(expected),
            "missing version evidence {expected:?}:\n{combined}"
        );
    }
}

#[cfg(all(not(windows), feature = "desktop"))]
#[test]
fn tauri_app_launches_registered_platform_kallisto() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_rna-seq-local-desktop"))
        .arg("--verify-bundled-sidecars")
        .output()
        .expect("the Tauri application binary should start");
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.status.success(),
        "the Tauri application did not verify its Kallisto sidecar:\n{combined}"
    );
    assert!(
        combined.contains("Kallisto\t0.52.0"),
        "missing Kallisto version evidence:\n{combined}"
    );
}
