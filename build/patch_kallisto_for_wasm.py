#!/usr/bin/env python3
from pathlib import Path
import sys

support_dir = Path(__file__).resolve().parent
root = Path(sys.argv[1]).resolve()
root_cmake = root / 'CMakeLists.txt'
src_cmake = root / 'src' / 'CMakeLists.txt'
main_cpp = root / 'src' / 'main.cpp'
kmer_index_cpp = root / 'src' / 'KmerIndex.cpp'
process_reads_h = root / 'src' / 'ProcessReads.h'
process_reads_cpp = root / 'src' / 'ProcessReads.cpp'
bifrost_root_cmake = root / 'ext' / 'bifrost' / 'CMakeLists.txt'
bifrost_src_cmake = root / 'ext' / 'bifrost' / 'src' / 'CMakeLists.txt'
data_storage_tcc = root / 'ext' / 'bifrost' / 'src' / 'DataStorage.tcc'
zlib_ng_cmake = root / 'ext' / 'zlib-ng' / 'CMakeLists.txt'
read_processor_operator_inc = support_dir / 'wasm_read_processor_operator.cpp.inc'
paired_fastq_inc = support_dir / 'wasm_paired_fastq.cpp.inc'

for path in (
    root_cmake, src_cmake, main_cpp, kmer_index_cpp, process_reads_h,
    process_reads_cpp, bifrost_root_cmake,
    bifrost_src_cmake, data_storage_tcc, zlib_ng_cmake,
    read_processor_operator_inc, paired_fastq_inc,
):
    if not path.exists():
        raise SystemExit(f'Missing expected kallisto source file: {path}')

# ---------------------------------------------------------------------------
# 0. zlib-ng 2.1.0's architecture detector predates WebAssembly support.
#    Under Emscripten it can fall back to CMAKE_SYSTEM_PROCESSOR=x86, which
#    incorrectly enables arch/x86/* sources (cpuid.h, AVX/SSE intrinsics).
#    Force a generic WebAssembly architecture after zlib-ng's detector runs.
#    The whole library is still compiled with -msimd128, so LLVM can
#    auto-vectorize generic C code to WebAssembly SIMD without x86 CPUID code.
# ---------------------------------------------------------------------------
zlib_text = zlib_ng_cmake.read_text()
arch_include = 'include(cmake/detect-arch.cmake)'
if arch_include not in zlib_text:
    raise SystemExit('Could not locate zlib-ng architecture detection include.')
wasm_arch_block = r'''include(cmake/detect-arch.cmake)

# KALLISTO_WEB_ZLIBNG_WASM_ARCH_FIX
if(EMSCRIPTEN)
    message(STATUS "zlib-ng: forcing generic WebAssembly architecture (no x86 CPUID/AVX/SSE sources)")
    set(ARCH "wasm64")
    set(BASEARCH "wasm")
    unset(BASEARCH_X86_FOUND)
    unset(BASEARCH_ARM_FOUND)
    unset(BASEARCH_PPC_FOUND)
    unset(BASEARCH_S360_FOUND)
    unset(BASEARCH_ALPHA_FOUND)
    unset(BASEARCH_BLACKFIN_FOUND)
    unset(BASEARCH_IA64_FOUND)
    unset(BASEARCH_MIPS_FOUND)
    unset(BASEARCH_M68K_FOUND)
    unset(BASEARCH_SH_FOUND)
    unset(BASEARCH_SPARC_FOUND)
    unset(BASEARCH_PARISC_FOUND)
    unset(BASEARCH_RS6000_FOUND)
    unset(BASEARCH_RISCV_FOUND)
endif()'''
zlib_text = zlib_text.replace(arch_include, wasm_arch_block, 1)
zlib_ng_cmake.write_text(zlib_text)

# ---------------------------------------------------------------------------
# 1. Build vendored zlib-ng and Bifrost in the same Emscripten CMake tree.
#    zlib-ng is configured in ZLIB_COMPAT mode, so kallisto/kseq keep using
#    the ordinary zlib API (gzopen/gzread/etc.) while the implementation is
#    zlib-ng. This avoids Emscripten's -sUSE_ZLIB=1 port in v10.
# ---------------------------------------------------------------------------
root_text = root_cmake.read_text()
# kallisto's global C++ warning suppressions otherwise leak into zlib-ng C files.
root_text = root_text.replace(
    'add_compile_options(-Wno-deprecated-declarations -Wno-subobject-linkage) # Suppress bifrost warning',
    'add_compile_options($<$<COMPILE_LANGUAGE:CXX>:-Wno-deprecated-declarations> $<$<COMPILE_LANGUAGE:CXX>:-Wno-subobject-linkage>) # Suppress bifrost warning'
)
start = root_text.index('include(ExternalProject)')
end = root_text.index('\n\n\nadd_subdirectory(src)', start)
replacement = r'''# KALLISTO_WEB_WASM_PATCH_V10
if(EMSCRIPTEN)
    message(STATUS "Configuring kallisto for WebAssembly v10")
    message(STATUS "Using vendored zlib-ng in zlib-compatible mode")

    set(ZLIBNG ON CACHE BOOL "Use vendored zlib-ng" FORCE)
    set(ZLIB_COMPAT ON CACHE BOOL "Expose zlib-compatible API" FORCE)
    set(ZLIB_ENABLE_TESTS OFF CACHE BOOL "Disable zlib-ng tests" FORCE)
    set(WITH_GZFILEOP ON CACHE BOOL "Enable gzFile API" FORCE)
    set(WITH_NATIVE_INSTRUCTIONS OFF CACHE BOOL "No native host ISA in Wasm build" FORCE)
    set(WITH_SANITIZER OFF CACHE STRING "Disable zlib-ng sanitizers" FORCE)
    # Belt-and-suspenders: these should not exist after the generic Wasm arch
    # override, but force them OFF if an upstream zlib-ng revision defines them.
    set(WITH_AVX2 OFF CACHE BOOL "No x86 AVX2 in WebAssembly" FORCE)
    set(WITH_AVX512 OFF CACHE BOOL "No x86 AVX512 in WebAssembly" FORCE)
    set(WITH_AVX512VNNI OFF CACHE BOOL "No x86 AVX512 VNNI in WebAssembly" FORCE)
    set(WITH_SSE2 OFF CACHE BOOL "No x86 SSE2 in WebAssembly" FORCE)
    set(WITH_SSSE3 OFF CACHE BOOL "No x86 SSSE3 in WebAssembly" FORCE)
    set(WITH_SSE41 OFF CACHE BOOL "No x86 SSE4.1 in WebAssembly" FORCE)
    set(WITH_SSE42 OFF CACHE BOOL "No x86 SSE4.2 in WebAssembly" FORCE)
    set(WITH_PCLMULQDQ OFF CACHE BOOL "No x86 PCLMUL in WebAssembly" FORCE)
    set(WITH_VPCLMULQDQ OFF CACHE BOOL "No x86 VPCLMUL in WebAssembly" FORCE)
    set(WITH_BENCHMARKS OFF CACHE BOOL "Disable zlib-ng benchmarks" FORCE)
    set(WITH_BENCHMARK_APPS OFF CACHE BOOL "Disable zlib-ng benchmark apps" FORCE)
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "Static libraries for Wasm" FORCE)

    add_subdirectory(${EXT_PROJECTS_DIR}/zlib-ng ${CMAKE_BINARY_DIR}/zlib-ng)
    target_compile_options(zlib PRIVATE -O3 -flto -msimd128)
    include_directories(${EXT_PROJECTS_DIR}/bifrost/src)
    add_subdirectory(${EXT_PROJECTS_DIR}/bifrost)
else()
include(ExternalProject)
if (USE_BAM)
ExternalProject_Add(htslib
    PREFIX ${PROJECT_SOURCE_DIR}/ext/htslib
    SOURCE_DIR ${PROJECT_SOURCE_DIR}/ext/htslib
    BUILD_IN_SOURCE 1
    CONFIGURE_COMMAND ""
    BUILD_COMMAND ""
    INSTALL_COMMAND ""
)
endif(USE_BAM)

ExternalProject_Add(bifrost
    PREFIX ${PROJECT_SOURCE_DIR}/ext/bifrost
    SOURCE_DIR ${PROJECT_SOURCE_DIR}/ext/bifrost
    BUILD_IN_SOURCE 1
    CONFIGURE_COMMAND mkdir -p build && cd build && cmake .. -DMAX_KMER_SIZE=${MAX_KMER_SIZE} -DCMAKE_INSTALL_PREFIX=${PREFIX} -DCMAKE_CXX_FLAGS=${PROJECT_BIFROST_CMAKE_CXX_FLAGS} ${DO_ENABLE_AVX2} ${DO_ENABLE_COMPILATION_ARCH}
    BUILD_COMMAND cd build && make
    INSTALL_COMMAND ""
)

if (ZLIBNG)
    message("zlib-ng enabled.")
    ExternalProject_Add(zlib-ng
    PREFIX ${PROJECT_SOURCE_DIR}/ext/zlib-ng
    SOURCE_DIR ${PROJECT_SOURCE_DIR}/ext/zlib-ng
    BUILD_IN_SOURCE 1
    CONFIGURE_COMMAND mkdir -p zlib-ng && cd zlib-ng && cmake .. -DZLIB_COMPAT=ON -DZLIB_ENABLE_TESTS=OFF -DCMAKE_INSTALL_PREFIX=${PREFIX}
    BUILD_COMMAND cd zlib-ng && make
    INSTALL_COMMAND ""
    )
endif(ZLIBNG)

if (USE_BAM)
    include_directories(${htslib_PREFIX}/src/htslib)
endif(USE_BAM)

include_directories(${EXT_PROJECTS_DIR}/bifrost/build/src)
ExternalProject_Get_Property(bifrost install_dir)
include_directories(${install_dir}/src)
endif()
'''
root_text = root_text[:start] + replacement + root_text[end:]
root_cmake.write_text(root_text)

# ---------------------------------------------------------------------------
# 2. Bifrost: omit x86-only -mno-avx2 under Emscripten.
# ---------------------------------------------------------------------------
bifrost_root_text = bifrost_root_cmake.read_text()
old_avx = '''if(ENABLE_AVX2 MATCHES "OFF")\n\tmessage("Disabling AVX2 instructions")\n\tset(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -mno-avx2")\n\tset(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -mno-avx2")\nendif(ENABLE_AVX2 MATCHES "OFF")'''
new_avx = '''if(ENABLE_AVX2 MATCHES "OFF")\n\tmessage("Disabling AVX2 instructions")\n\tif(NOT EMSCRIPTEN)\n\t\tset(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -mno-avx2")\n\t\tset(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -mno-avx2")\n\tendif()\nendif(ENABLE_AVX2 MATCHES "OFF")'''
if old_avx not in bifrost_root_text:
    raise SystemExit('Could not locate Bifrost AVX2-disable block; upstream source changed.')
bifrost_root_text = bifrost_root_text.replace(old_avx, new_avx, 1)
bifrost_root_cmake.write_text(bifrost_root_text)

# ---------------------------------------------------------------------------
# 3. Bifrost: in Emscripten builds, link the in-tree zlib-ng target rather
#    than find_package(ZLIB), which would resolve to the stock Emscripten port.
# ---------------------------------------------------------------------------
bifrost_src_text = bifrost_src_cmake.read_text()
old_zlib = '''find_package(ZLIB REQUIRED)\ntarget_link_libraries(bifrost_static ${ZLIB_LIBRARIES})\ntarget_link_libraries(bifrost_dynamic ${ZLIB_LIBRARIES})\n\nif (ZLIB_FOUND)\n    if (DEFINED ZLIB_INCLUDE_DIRS)\n        include_directories( ${ZLIB_INCLUDE_DIRS} )\n    elseif (DEFINED ZLIB_INCLUDE_DIR)\n        include_directories( ${ZLIB_INCLUDE_DIR} )\n    else()\n        message(FATAL_ERROR "zlib found but no include directories are set.")\n    endif()\nelse()\n    message(FATAL_ERROR "zlib not found. Required for to output files")\nendif(ZLIB_FOUND)'''
new_zlib = '''if(EMSCRIPTEN)\n    target_link_libraries(bifrost_static zlibstatic)\n    target_link_libraries(bifrost_dynamic zlibstatic)\nelse()\n    find_package(ZLIB REQUIRED)\n    target_link_libraries(bifrost_static ${ZLIB_LIBRARIES})\n    target_link_libraries(bifrost_dynamic ${ZLIB_LIBRARIES})\n\n    if (ZLIB_FOUND)\n        if (DEFINED ZLIB_INCLUDE_DIRS)\n            include_directories( ${ZLIB_INCLUDE_DIRS} )\n        elseif (DEFINED ZLIB_INCLUDE_DIR)\n            include_directories( ${ZLIB_INCLUDE_DIR} )\n        else()\n            message(FATAL_ERROR "zlib found but no include directories are set.")\n        endif()\n    else()\n        message(FATAL_ERROR "zlib not found. Required for to output files")\n    endif(ZLIB_FOUND)\nendif()'''
if old_zlib not in bifrost_src_text:
    raise SystemExit('Could not locate Bifrost zlib block; upstream source changed.')
bifrost_src_text = bifrost_src_text.replace(old_zlib, new_zlib, 1)
bifrost_src_cmake.write_text(bifrost_src_text)

# ---------------------------------------------------------------------------
# 4. Fix the vendored Bifrost v0.52.0 copy-constructor typo that is exposed by
#    the WebAssembly build.
# ---------------------------------------------------------------------------
data_text = data_storage_tcc.read_text()
needle = 'unitig_cs_link[i] = o.sz_link[i].load();'
if needle in data_text:
    data_text = data_text.replace(needle, 'unitig_cs_link[i] = o.unitig_cs_link[i].load();')
elif 'o.unitig_cs_link[i].load()' not in data_text:
    raise SystemExit('Could not locate expected Bifrost DataStorage copy-constructor line.')
data_storage_tcc.write_text(data_text)

# ---------------------------------------------------------------------------
# 5. kallisto executable: native Memory64, pthreads, 9-worker pool, 8 MiB
#    stacks. Eight workers are available to ReadProcessor; the ninth is the
#    bounded helper used to decompress paired R1/R2 streams concurrently.
#    LTO/SIMD/O3 are supplied globally by build-wasm.sh so they also
#    apply to kallisto_core, Bifrost and zlib-ng. Link zlib-ng directly and do
#    NOT use -sUSE_ZLIB=1.
# ---------------------------------------------------------------------------
src_text = src_cmake.read_text()
insert_at = src_text.index('find_package( Threads REQUIRED )')
wasm_block = r'''# KALLISTO_WEB_WASM_PATCH_V10
if(EMSCRIPTEN)
    target_link_libraries(kallisto_core PUBLIC zlibstatic)
    target_link_libraries(kallisto PRIVATE kallisto_core bifrost_static zlibstatic)

    target_compile_options(kallisto_core PRIVATE -pthread -sMEMORY64=1)
    target_compile_options(kallisto PRIVATE -pthread -sMEMORY64=1)

    # Selective optimization: keep KmerIndex.cpp/Bifrost at plain -O3.
    set_source_files_properties(
        ProcessReads.cpp MinCollector.cpp weights.cpp main.cpp
        PROPERTIES COMPILE_OPTIONS "-flto;-msimd128"
    )

    target_link_options(kallisto PRIVATE
        -sMEMORY64=1
        -pthread
        -sMODULARIZE=1
        -sEXPORT_NAME=createKallisto
        -sINVOKE_RUN=0
        -sEXIT_RUNTIME=0
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=268435456
        -sMAXIMUM_MEMORY=3221225472
        -sASSERTIONS=1
        -sSTACK_SIZE=8388608
        -sDEFAULT_PTHREAD_STACK_SIZE=8388608
        -sPTHREAD_POOL_SIZE=9
        -sFORCE_FILESYSTEM=1
        "-sEXPORTED_RUNTIME_METHODS=['FS','WORKERFS','callMain']"
        "-sINCOMING_MODULE_JS_API=['ENVIRONMENT','arguments','canvas','dynamicLibraries','elementPointerLock','instantiateWasm','locateFile','monitorRunDependencies','noExitRuntime','noInitialRun','onAbort','onExit','onRuntimeInitialized','postRun','preInit','preRun','print','printErr','setStatus','statusMessage','stderr','stdin','stdout','thisProgram','wasm','websocket','mainScriptUrlOrBlob']"
        -lworkerfs.js
        -sENVIRONMENT=worker
    )
    return()
endif()

'''
src_text = src_text[:insert_at] + wasm_block + src_text[insert_at:]
src_cmake.write_text(src_text)

# ---------------------------------------------------------------------------
# 6. Emit lightweight stage checkpoints from the existing kallisto quant path.
#    The browser worker timestamps these lines with performance.now(). The
#    numerical algorithm is untouched.
# ---------------------------------------------------------------------------
main_text = main_cpp.read_text()
em_long_options_needle = '''  const char *opt_string = "t:i:l:P:s:o:n:m:d:b:g:c:p:";
  static struct option long_options[] = {// long args'''
em_long_options_replace = '''  const char *opt_string = "t:i:l:P:s:o:n:m:d:b:g:c:p:";
  // getopt_long stores through these pointers. callMain is reused for every
  // browser sample, so this table must not retain the prior call's stack.
  struct option long_options[] = {// long args'''
if em_long_options_needle not in main_text:
    raise SystemExit('Could not locate ParseOptionsEM long option table.')
main_text = main_text.replace(em_long_options_needle, em_long_options_replace, 1)
main_entry_needle = '''int main(int argc, char *argv[]) {
  std::cout.sync_with_stdio(false);'''
main_entry_replace = '''int main(int argc, char *argv[]) {
#ifdef __EMSCRIPTEN__
  // callMain invokes this entry point repeatedly for sequential browser samples.
  // musl getopt uses optind=0 to reset its internal scan position.
  optind = 0;
#endif
  std::cout.sync_with_stdio(false);'''
if main_entry_needle not in main_text:
    raise SystemExit('Could not locate kallisto main entry point for getopt reset.')
main_text = main_text.replace(main_entry_needle, main_entry_replace, 1)
replacements = [
    (
        '''        // run the em algorithm\n        KmerIndex index(opt);\n        index.load(opt);''',
        '''        // run the em algorithm\n        KmerIndex index(opt);\n        std::cerr << "[WEBPERF] index_load_begin" << std::endl;\n        ProgramOptions index_load_opt = opt;\n        index_load_opt.threads = 1;\n        std::cerr << "[WEBPERF] index_load_threads=1 quant_threads=" << opt.threads << std::endl;\n        index.load(index_load_opt);\n        std::cerr << "[WEBPERF] index_load_end" << std::endl;'''
    ),
    (
        '''        MinCollector collection(index, opt);\n        MasterProcessor MP(index, opt, collection, model);\n        num_processed = ProcessReads(MP, opt);''',
        '''        MinCollector collection(index, opt);\n        MasterProcessor MP(index, opt, collection, model);\n        std::cerr << "[WEBPERF] pseudoalign_begin" << std::endl;\n        num_processed = ProcessReads(MP, opt);\n        std::cerr << "[WEBPERF] pseudoalign_end" << std::endl;'''
    ),
    (
        '''        em.run(10000, 50, true, opt.bias);''',
        '''        std::cerr << "[WEBPERF] em_begin" << std::endl;\n        em.run(10000, 50, true, opt.bias);\n        std::cerr << "[WEBPERF] em_end" << std::endl;'''
    ),
    (
        '''        plaintext_aux(\n            opt.output + "/run_info.json",''',
        '''        std::cerr << "[WEBPERF] output_begin" << std::endl;\n        plaintext_aux(\n            opt.output + "/run_info.json",'''
    ),
    (
        '''        if (opt.pseudobam) {\n#ifndef NO_HTSLIB\n          MP.processAln(em, true);\n#endif\n        }\n\n        std::cerr << std::endl;''',
        '''        if (opt.pseudobam) {\n#ifndef NO_HTSLIB\n          MP.processAln(em, true);\n#endif\n        }\n\n        std::cerr << "[WEBPERF] output_end" << std::endl;\n        std::cerr << std::endl;'''
    ),
]
for old, new in replacements:
    if old not in main_text:
        raise SystemExit(f'Could not insert WEBPERF checkpoint; upstream main.cpp changed near: {old[:80]!r}')
    main_text = main_text.replace(old, new, 1)
main_cpp.write_text(main_text)

# ---------------------------------------------------------------------------
# 7. Browser FASTQ input tuning. ReadProcessor owns one buffer per worker, so
#    cap the total at 128 MiB: 32 MiB for 1-4 threads and 16 MiB for 5-8.
#    The reader lock continues to cover fetchSequences only; pseudoalignment
#    remains outside the lock. zlib-ng exposes gzbuffer through ZLIB_COMPAT.
# ---------------------------------------------------------------------------
process_h_text = process_reads_h.read_text()
if '#include <condition_variable>\n' not in process_h_text:
    raise SystemExit('Could not locate ProcessReads.h standard include block.')
process_h_text = process_h_text.replace(
    '#include <condition_variable>\n',
    '#include <condition_variable>\n#include <deque>\n#include <functional>\n', 1)
include_needle = '#include "BUSTools.h"\n'
include_replace = '''#include "BUSTools.h"

inline size_t read_batch_bytes_for_threads(int threads) {
#ifdef __EMSCRIPTEN__
  return threads <= 4 ? (1ULL << 25) : (1ULL << 24);
#else
  (void)threads;
  return 1ULL << 23;
#endif
}

#ifdef __EMSCRIPTEN__
constexpr unsigned int KALLISTO_WEB_GZIP_BUFFER_BYTES = 1U << 20;
#endif
'''
if include_needle not in process_h_text:
    raise SystemExit('Could not locate ProcessReads.h include insertion point.')
process_h_text = process_h_text.replace(include_needle, include_replace, 1)
buffer_needle = ',nummapped(0), num_umi(0), bufsize(1ULL<<23), tlencount(0)'
buffer_replace = ',nummapped(0), num_umi(0), bufsize(read_batch_bytes_for_threads(opt.threads)), tlencount(0)'
if buffer_needle not in process_h_text:
    raise SystemExit('Could not locate MasterProcessor read buffer initializer.')
process_h_text = process_h_text.replace(buffer_needle, buffer_replace, 1)
fastq_method_needle = '''                      bool full=false,
                      bool comments=false);

public:
  int nfiles = 1;'''
fastq_method_replace = '''                      bool full=false,
                      bool comments=false);
#ifdef __EMSCRIPTEN__
  bool fetchPairedSequencesParallel(
      char *buf, const int limit,
      std::vector<std::pair<const char*, int>>& seqs,
      std::vector<uint32_t>& flags, int &readbatch_id);
  void startPairedReaderHelper();
  void stopPairedReaderHelper();
#endif

public:
  int nfiles = 1;'''
if fastq_method_needle not in process_h_text:
    raise SystemExit('Could not locate FastqSequenceReader method declarations.')
process_h_text = process_h_text.replace(fastq_method_needle, fastq_method_replace, 1)
fastq_state_needle = '''  std::vector<kseq_t*> seq;
  int interleave_nfiles;
};'''
fastq_state_replace = '''  std::vector<kseq_t*> seq;
  int interleave_nfiles;
#ifdef __EMSCRIPTEN__
  std::deque<std::string> paired_pending[2];
  std::thread paired_reader_helper;
  std::mutex paired_reader_helper_mutex;
  std::condition_variable paired_reader_helper_cv;
  std::condition_variable paired_reader_done_cv;
  std::function<void()> paired_reader_task;
  bool paired_reader_task_ready = false;
  bool paired_reader_task_done = false;
  bool paired_reader_stop = false;
  void beginPairedReaderTask(const std::function<void()>& task);
  void waitPairedReaderTask();
#endif
};'''
if fastq_state_needle not in process_h_text:
    raise SystemExit('Could not locate FastqSequenceReader state fields.')
process_h_text = process_h_text.replace(fastq_state_needle, fastq_state_replace, 1)
read_processor_stats_needle = '''  void operator()();
  void processBuffer();
  void clear();
};'''
read_processor_stats_replace = '''  void operator()();
  void processBuffer();
  void clear();
#ifdef __EMSCRIPTEN__
  void reportWebThreadStats();
  uint64_t web_batches = 0;
  uint64_t web_reads = 0;
  uint64_t web_reader_wait_us = 0;
  uint64_t web_fetch_us = 0;
  uint64_t web_process_us = 0;
  uint64_t web_update_us = 0;
  uint64_t web_total_us = 0;
  bool web_stats_reported = false;
#endif
};'''
if read_processor_stats_needle not in process_h_text:
    raise SystemExit('Could not locate ReadProcessor method declarations.')
process_h_text = process_h_text.replace(
    read_processor_stats_needle, read_processor_stats_replace, 1)
process_reads_h.write_text(process_h_text)

process_cpp_text = process_reads_cpp.read_text()
if '#include <algorithm>\n' not in process_cpp_text:
    raise SystemExit('Could not locate ProcessReads.cpp include block.')
process_cpp_text = process_cpp_text.replace(
    '#include <algorithm>\n', '#include <algorithm>\n#include <chrono>\n', 1)
process_reads_marker = '''void MasterProcessor::processReads() {
  // start worker threads'''
process_reads_marker_replace = '''void MasterProcessor::processReads() {
#ifdef __EMSCRIPTEN__
  const bool paired_parallel_gzip = !opt.batch_mode && !opt.bus_mode && !opt.single_end &&
                                    opt.threads > 1 && !opt.pseudobam && !opt.fusion && !opt.bam;
  std::cerr << "[WEBPERF] active_read_workers=" << opt.threads
            << " paired_parallel_gzip=" << (paired_parallel_gzip ? 1 : 0) << std::endl;
#endif
  // start worker threads'''
if process_reads_marker not in process_cpp_text:
    raise SystemExit('Could not locate MasterProcessor read dispatch marker.')
process_cpp_text = process_cpp_text.replace(process_reads_marker, process_reads_marker_replace, 1)
worker_start_needle = '''  if (!opt.batch_mode && !opt.bus_mode) {
    std::vector<std::thread> workers;'''
worker_start_replace = '''  if (!opt.batch_mode && !opt.bus_mode) {
#ifdef __EMSCRIPTEN__
    FastqSequenceReader *paired_reader = nullptr;
    if (paired_parallel_gzip) {
      paired_reader = static_cast<FastqSequenceReader *>(SR);
      paired_reader->startPairedReaderHelper();
    }
#endif
    std::vector<std::thread> workers;'''
if worker_start_needle not in process_cpp_text:
    raise SystemExit('Could not locate read worker start block.')
process_cpp_text = process_cpp_text.replace(worker_start_needle, worker_start_replace, 1)
worker_stop_needle = '''    for (int i = 0; i < opt.threads; i++) {
      workers[i].join();  // wait for them to finish
    }

    // now handle the modification of the mincollector'''
worker_stop_replace = '''    for (int i = 0; i < opt.threads; i++) {
      workers[i].join();  // wait for them to finish
    }
#ifdef __EMSCRIPTEN__
    if (paired_reader) {
      paired_reader->stopPairedReaderHelper();
    }
#endif

    // now handle the modification of the mincollector'''
if worker_stop_needle not in process_cpp_text:
    raise SystemExit('Could not locate read worker join block.')
process_cpp_text = process_cpp_text.replace(worker_stop_needle, worker_stop_replace, 1)
operator_begin = process_cpp_text.find('void ReadProcessor::operator()() {')
operator_end = process_cpp_text.find('\nvoid ReadProcessor::processBuffer()', operator_begin)
if operator_begin < 0 or operator_end < 0:
    raise SystemExit('Could not locate ReadProcessor operator implementation.')
operator_text = read_processor_operator_inc.read_text().rstrip()
process_cpp_text = process_cpp_text[:operator_begin] + operator_text + process_cpp_text[operator_end:]
open_needle = '''          fp[i] = files[0] == "-" && nfiles == 1 ? gzdopen(fileno(stdin), "r")
                                                 : gzopen(files[current_file + i].c_str(), "r");
          seq[i] = kseq_init(fp[i]);
          l[i] = kseq_read(seq[i]);'''
open_replace = '''          if (seq[i]) {
            kseq_destroy(seq[i]);
            seq[i] = nullptr;
          }
          fp[i] = files[0] == "-" && nfiles == 1 ? gzdopen(fileno(stdin), "r")
                                                 : gzopen(files[current_file + i].c_str(), "r");
          if (!fp[i]) {
            std::cerr << "Error: could not open input file " << files[current_file + i]
                      << std::endl;
            exit(1);
          }
#ifdef __EMSCRIPTEN__
          if (gzbuffer(fp[i], KALLISTO_WEB_GZIP_BUFFER_BYTES) != 0) {
            std::cerr << "[~warn] could not set 1 MiB gzip input buffer for "
                      << files[current_file + i] << std::endl;
          }
#endif
          seq[i] = kseq_init(fp[i]);
          l[i] = kseq_read(seq[i]);'''
if open_needle not in process_cpp_text:
    raise SystemExit('Could not locate FASTQ gzopen/kseq initialization block.')
process_cpp_text = process_cpp_text.replace(open_needle, open_replace, 1)
paired_insert_needle = '''// returns true if there is more left to read from the files
bool FastqSequenceReader::fetchSequences'''
if paired_insert_needle not in process_cpp_text:
    raise SystemExit('Could not locate paired FASTQ reader insertion point.')
process_cpp_text = process_cpp_text.replace(
    paired_insert_needle,
    paired_fastq_inc.read_text().rstrip() + '\n\n' + paired_insert_needle,
    1)
destructor_needle = '''FastqSequenceReader::~FastqSequenceReader() {
  for (auto &f : fp) {'''
destructor_replace = '''FastqSequenceReader::~FastqSequenceReader() {
#ifdef __EMSCRIPTEN__
  stopPairedReaderHelper();
#endif
  for (auto &f : fp) {'''
if destructor_needle not in process_cpp_text:
    raise SystemExit('Could not locate FastqSequenceReader destructor.')
process_cpp_text = process_cpp_text.replace(destructor_needle, destructor_replace, 1)
eof_needle = '''    } else {
      state = false;  // haven't opened file yet
    }
  }
}

// move constructor'''
eof_replace = '''    } else {
      bool malformed = false;
      bool some_reads_remain = false;
      for (int i = 0; i < nfiles; i++) {
        malformed = malformed || l[i] < -1;
        some_reads_remain = some_reads_remain || l[i] >= 0;
      }
      if (malformed) {
        std::cerr << "Error: malformed or truncated FASTQ record" << std::endl;
        exit(1);
      }
      if (paired && nfiles == 2 && some_reads_remain) {
        std::cerr << "Error: paired-end FASTQ files contain different numbers of reads"
                  << std::endl;
        exit(1);
      }
      state = false;  // haven't opened file yet
    }
  }
}

// move constructor'''
if eof_needle not in process_cpp_text:
    raise SystemExit('Could not locate FASTQ EOF handling block.')
process_cpp_text = process_cpp_text.replace(eof_needle, eof_replace, 1)
reset_pending_needle = '''  for (auto &s : seq) {
    kseq_destroy(s);
    s = nullptr;
  }
}

void FastqSequenceReader::reserveNfiles'''
reset_pending_replace = '''  for (auto &s : seq) {
    kseq_destroy(s);
    s = nullptr;
  }
#ifdef __EMSCRIPTEN__
  paired_pending[0].clear();
  paired_pending[1].clear();
#endif
}

void FastqSequenceReader::reserveNfiles'''
if reset_pending_needle not in process_cpp_text:
    raise SystemExit('Could not locate FastqSequenceReader reset cleanup.')
process_cpp_text = process_cpp_text.replace(reset_pending_needle, reset_pending_replace, 1)
move_pending_needle = '''      interleave_nfiles(o.interleave_nfiles),
      seq(std::move(o.seq)) {
  o.fp.resize(nfiles);'''
move_pending_replace = '''      interleave_nfiles(o.interleave_nfiles),
      seq(std::move(o.seq)) {
#ifdef __EMSCRIPTEN__
  paired_pending[0] = std::move(o.paired_pending[0]);
  paired_pending[1] = std::move(o.paired_pending[1]);
#endif
  o.fp.resize(nfiles);'''
if move_pending_needle not in process_cpp_text:
    raise SystemExit('Could not locate FastqSequenceReader move constructor.')
process_cpp_text = process_cpp_text.replace(move_pending_needle, move_pending_replace, 1)
clear_needle = '''void ReadProcessor::clear() {
  numreads = 0;
  memset(buffer, 0, bufsize);'''
clear_replace = '''void ReadProcessor::clear() {
  numreads = 0;
#ifndef __EMSCRIPTEN__
  memset(buffer, 0, bufsize);
#endif'''
if clear_needle not in process_cpp_text:
    raise SystemExit('Could not locate ReadProcessor buffer clear.')
process_cpp_text = process_cpp_text.replace(clear_needle, clear_replace, 1)
process_reads_cpp.write_text(process_cpp_text)

batch_marker_needle = '''        MinCollector collection(index, opt);
        MasterProcessor MP(index, opt, collection, model);
        std::cerr << "[WEBPERF] pseudoalign_begin" << std::endl;'''
batch_marker_replace = '''        MinCollector collection(index, opt);
        MasterProcessor MP(index, opt, collection, model);
#ifdef __EMSCRIPTEN__
        std::cerr << "[WEBPERF] read_batch_bytes=" << MP.bufsize
                  << " gzip_buffer_bytes=" << KALLISTO_WEB_GZIP_BUFFER_BYTES << std::endl;
#endif
        std::cerr << "[WEBPERF] pseudoalign_begin" << std::endl;'''
main_text = main_cpp.read_text()
if batch_marker_needle not in main_text:
    raise SystemExit('Could not locate WEBPERF read buffer marker insertion point.')
main_text = main_text.replace(batch_marker_needle, batch_marker_replace, 1)
main_cpp.write_text(main_text)


# v10.3 index-load diagnostics and integrity checks.
kidx_text = kmer_index_cpp.read_text()
needle = '  std::cerr << "[index] k-mer length: " << std::to_string(k) << std::endl;\n\n  // 2.2 deserialize distinguishing flanking k-mers for D-list'
replace = '  std::cerr << "[index] k-mer length: " << std::to_string(k) << std::endl;\n  std::cerr << "[WEBPERF] index_graph_loaded" << std::endl;\n\n  // 2.2 deserialize distinguishing flanking k-mers for D-list'
if needle not in kidx_text: raise SystemExit('graph checkpoint point missing')
kidx_text = kidx_text.replace(needle, replace, 1)
needle = """  in.read((char*)&dlist_size, sizeof(dlist_size));
  in.read((char*)&dlist_overhang, sizeof(dlist_overhang));
  d_list.reserve(dlist_size);"""
replace = """  in.read((char*)&dlist_size, sizeof(dlist_size));
  in.read((char*)&dlist_overhang, sizeof(dlist_overhang));
  if (!in.good()) {
    std::cerr << "Error: truncated/corrupt index immediately after graph/MPHF" << std::endl;
    exit(1);
  }
  std::cerr << "[WEBPERF] index_dlist_header size=" << dlist_size << " overhang=" << dlist_overhang << std::endl;
  d_list.reserve(dlist_size);"""
if needle not in kidx_text: raise SystemExit('dlist point missing')
kidx_text = kidx_text.replace(needle, replace, 1)
needle = """  // 3. deserialize nodes
  Kmer kmer;"""
replace = """  std::cerr << "[WEBPERF] index_dlist_loaded" << std::endl;

  // 3. deserialize nodes
  Kmer kmer;"""
if needle not in kidx_text: raise SystemExit('node section point missing')
kidx_text = kidx_text.replace(needle, replace, 1)
needle = """  in.read((char*)&tmp_size, sizeof(tmp_size));
  const size_t max_num_nodes_buffer = 524288;"""
replace = """  in.read((char*)&tmp_size, sizeof(tmp_size));
  if (!in.good()) {
    std::cerr << "Error: truncated/corrupt index before node records" << std::endl;
    exit(1);
  }
  std::cerr << "[WEBPERF] index_node_records=" << tmp_size << " graph_unitigs=" << dbg.size() << std::endl;
  const size_t max_num_nodes_buffer = 524288;"""
if needle not in kidx_text: raise SystemExit('node count point missing')
kidx_text = kidx_text.replace(needle, replace, 1)
needle = """  std::vector<std::thread>().swap(workers);

  // 4. read number of targets"""
replace = """  std::vector<std::thread>().swap(workers);
  if (!in.good()) {
    std::cerr << "Error: truncated/corrupt index while deserializing node metadata" << std::endl;
    exit(1);
  }
  std::cerr << "[WEBPERF] index_nodes_loaded" << std::endl;

  // 4. read number of targets"""
if needle not in kidx_text: raise SystemExit('node finish point missing')
kidx_text = kidx_text.replace(needle, replace, 1)
kmer_index_cpp.write_text(kidx_text)

print('Patched kallisto v0.52.0 for browser build: Memory64, pthreads, bounded FASTQ buffers, zlib-ng gzbuffer, selective SIMD/LTO, serial/hardened index load, WEBPERF checkpoints.')
