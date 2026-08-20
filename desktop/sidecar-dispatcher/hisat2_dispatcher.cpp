// SPDX-License-Identifier: MIT
// A Windows-only launcher for the unmodified HISAT2 small/large executables.
// It keeps the desktop bundle independent of HISAT2's Python wrapper scripts.
#include <windows.h>
#include <shellapi.h>
#include <cstdio>
#include <string>
#include <vector>

static std::wstring quote(const std::wstring& value) {
  std::wstring result = L"\"";
  for (wchar_t character : value) {
    if (character == L'\"') result += L'\\';
    result += character;
  }
  return result + L"\"";
}

static bool exists(const std::wstring& path) {
  return GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES;
}

static std::wstring executable_directory() {
  std::vector<wchar_t> buffer(32768);
  DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  if (length == 0 || length >= buffer.size()) return L"";
  std::wstring path(buffer.data(), length);
  return path.substr(0, path.find_last_of(L"\\/"));
}

static std::wstring value_after(const std::vector<std::wstring>& args, const wchar_t* option) {
  for (size_t index = 0; index + 1 < args.size(); ++index) {
    if (args[index] == option) return args[index + 1];
  }
  return L"";
}

static bool has_option(const std::vector<std::wstring>& args, const wchar_t* option) {
  for (const auto& arg : args) {
    if (arg == option) return true;
  }
  return false;
}

static bool fasta_exceeds_small_index_limit(const std::wstring& fasta) {
  // The upstream wrapper changes to the large builder at approximately 4 Gbp.
  // FASTA files are local and are deliberately scanned in native code, never
  // copied into the WebView. Comma-separated reference inputs are supported.
  unsigned long long bases = 0;
  size_t start = 0;
  while (start <= fasta.size()) {
    size_t end = fasta.find(L',', start);
    std::wstring path = fasta.substr(start, end == std::wstring::npos ? end : end - start);
    // MinGW's C++11 fstream overloads do not accept std::wstring.  Use the
    // Win32-compatible wide C runtime API so paths stay Unicode-safe.
    FILE* input = _wfopen(path.c_str(), L"rb");
    if (input == nullptr) return false;  // hisat2-build reports the precise input error.
    bool header = false;
    int byte = 0;
    while ((byte = std::fgetc(input)) != EOF) {
      const char character = static_cast<char>(byte);
      if (character == '>') { header = true; continue; }
      if (character == '\n' || character == '\r') { header = false; continue; }
      if (!header && ((character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z'))) {
        // Keep this C++11-compatible: the CI dispatcher is deliberately
        // compiled with -std=c++11 for the widest MinGW compatibility.
        if (++bases > 3900000000ULL) {
          std::fclose(input);
          return true;
        }
      }
    }
    std::fclose(input);
    if (end == std::wstring::npos) break;
    start = end + 1;
  }
  return false;
}

static int launch(const std::wstring& helper, const std::vector<std::wstring>& args) {
  std::wstring command = quote(helper);
  for (const auto& arg : args) command += L" " + quote(arg);
  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(helper.c_str(), &command[0], nullptr, nullptr, TRUE, 0, nullptr,
                      executable_directory().c_str(), &startup, &process)) {
    std::fwprintf(stderr, L"Could not start verified HISAT2 helper: %ls (error %lu)\n", helper.c_str(), GetLastError());
    return 127;
  }
  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD exit_code = 1;
  GetExitCodeProcess(process.hProcess, &exit_code);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return static_cast<int>(exit_code);
}

int wmain() {
  int count = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &count);
  if (argv == nullptr || count < 1) return 64;
  std::vector<std::wstring> args;
  for (int index = 1; index < count; ++index) args.emplace_back(argv[index]);
  LocalFree(argv);
  const std::wstring dir = executable_directory();
#ifdef HISAT2_BUILD_DISPATCHER
  if (args.size() == 1 && args[0] == L"--version") {
    return launch(dir + L"\\hisat2-build-s.exe", args);
  }
  if (args.size() < 2) { std::fwprintf(stderr, L"HISAT2-build reference and output prefix are required.\n"); return 64; }
  const bool large = has_option(args, L"--large-index") || fasta_exceeds_small_index_limit(args[args.size() - 2]);
  const std::wstring helper = dir + L"\\hisat2-build-" + (large ? L"l.exe" : L"s.exe");
#else
  if (args.size() == 1 && args[0] == L"--version") {
    return launch(dir + L"\\hisat2-align-s.exe", args);
  }
  const std::wstring prefix = value_after(args, L"-x");
  if (prefix.empty()) { std::fwprintf(stderr, L"HISAT2 index prefix (-x) is required.\n"); return 64; }
  const std::wstring helper = dir + L"\\hisat2-align-" +
    (exists(prefix + L".1.ht2l") ? L"l.exe" : L"s.exe");
#endif
  if (!exists(helper)) { std::fwprintf(stderr, L"Required bundled HISAT2 helper is missing.\n"); return 127; }
  return launch(helper, args);
}
