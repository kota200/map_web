#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
src_cmake = root / 'src' / 'CMakeLists.txt'
bifrost_src_cmake = root / 'ext' / 'bifrost' / 'src' / 'CMakeLists.txt'
kmer_index = root / 'src' / 'KmerIndex.cpp'
compacted = root / 'ext' / 'bifrost' / 'src' / 'CompactedDBG.tcc'
kmercov = root / 'ext' / 'bifrost' / 'src' / 'KmerCovIndex.tcc'
io_tcc = root / 'ext' / 'bifrost' / 'src' / 'IO.tcc'

for p in (src_cmake, bifrost_src_cmake, kmer_index, compacted, kmercov, io_tcc):
    if not p.exists():
        raise SystemExit(f'Missing expected source file: {p}')

# ---------------------------------------------------------------------------
# Debug build flags.
# Keep native Memory64/pthreads/WORKERFS from the base Wasm patch, but compile
# the actual kallisto + Bifrost sources with ASan/UBSan and symbols.
# ---------------------------------------------------------------------------
src = src_cmake.read_text()
if '# KALLISTO_WEB_DEBUG_PATCH' not in src:
    src = src.replace(
        'target_compile_options(kallisto_core PRIVATE -pthread -sUSE_ZLIB=1 -sMEMORY64=1)',
        'target_compile_options(kallisto_core PRIVATE -pthread -sUSE_ZLIB=1 -sMEMORY64=1 -O0 -g3 -fno-omit-frame-pointer -fsanitize=address -fsanitize=undefined)'
    )
    src = src.replace(
        'target_compile_options(kallisto PRIVATE -pthread -sUSE_ZLIB=1 -sMEMORY64=1)',
        'target_compile_options(kallisto PRIVATE -pthread -sUSE_ZLIB=1 -sMEMORY64=1 -O0 -g3 -fno-omit-frame-pointer -fsanitize=address -fsanitize=undefined)'
    )
    src = src.replace('-sINITIAL_MEMORY=268435456', '-sINITIAL_MEMORY=536870912')
    src = src.replace('-sASSERTIONS=1', '-sASSERTIONS=2')
    needle = '        -sMAXIMUM_MEMORY=4294967296\n        -sASSERTIONS=2'
    repl = '''        -sMAXIMUM_MEMORY=4294967296
        -sASSERTIONS=2
        -sSTACK_OVERFLOW_CHECK=2
        -O0
        -g3
        -gsource-map
        -fno-omit-frame-pointer
        -fsanitize=address
        -fsanitize=undefined'''
    if needle not in src:
        raise SystemExit('Could not locate kallisto debug link-option insertion point.')
    src = src.replace(needle, repl, 1)
    src = src.replace('# KALLISTO_WEB_WASM_PATCH', '# KALLISTO_WEB_WASM_PATCH\n# KALLISTO_WEB_DEBUG_PATCH', 1)
    src_cmake.write_text(src)

bif = bifrost_src_cmake.read_text()
if '# KALLISTO_WEB_DEBUG_PATCH' not in bif:
    old = 'target_compile_options(bifrost_static PRIVATE -pthread -sUSE_ZLIB=1 -sMEMORY64=1)'
    new = 'target_compile_options(bifrost_static PRIVATE -pthread -sUSE_ZLIB=1 -sMEMORY64=1 -O0 -g3 -fno-omit-frame-pointer -fsanitize=address -fsanitize=undefined)'
    if old not in bif:
        raise SystemExit('Could not locate Bifrost compile options for debug patch.')
    bif = bif.replace(old, new, 1)
    bif = bif.replace('# KALLISTO_WEB_WASM_PATCH', '# KALLISTO_WEB_WASM_PATCH\n# KALLISTO_WEB_DEBUG_PATCH', 1)
    bifrost_src_cmake.write_text(bif)

# Helper for safe one-shot textual patches.
def inject_once(path: Path, marker: str, old: str, new: str):
    text = path.read_text()
    if marker in text:
        return
    if old not in text:
        raise SystemExit(f'Could not locate instrumentation point in {path}: {old[:100]!r}')
    text = text.replace(old, new, 1)
    path.write_text(text)

# ---------------------------------------------------------------------------
# KmerIndex checkpoints: distinguish dbg.build/toDataGraph completion from
# D-list handling and serialization.
# ---------------------------------------------------------------------------
inject_once(
    kmer_index,
    '[WASM DEBUG] KmerIndex::BuildDeBruijnGraph: dbg.build returned',
    '  dbg.build(c_opt);\n\n  // If off-list is supplied, add off-listed kmers flanking the common',
    '''  std::cerr << "[WASM DEBUG] KmerIndex::BuildDeBruijnGraph: dbg.build begin" << std::endl;
  const bool wasm_dbg_build_ok = dbg.build(c_opt);
  std::cerr << "[WASM DEBUG] KmerIndex::BuildDeBruijnGraph: dbg.build returned=" << wasm_dbg_build_ok
            << " size=" << dbg.size() << std::endl;

  // If off-list is supplied, add off-listed kmers flanking the common'''
)

inject_once(
    kmer_index,
    '[WASM DEBUG] KmerIndex::BuildDeBruijnGraph: DListFlankingKmers begin',
    '  DListFlankingKmers(opt, tmp_file, dfks);\n\n  // 1. write version',
    '''  std::cerr << "[WASM DEBUG] KmerIndex::BuildDeBruijnGraph: DListFlankingKmers begin" << std::endl;
  DListFlankingKmers(opt, tmp_file, dfks);
  std::cerr << "[WASM DEBUG] KmerIndex::BuildDeBruijnGraph: DListFlankingKmers done; dfks=" << dfks.size() << std::endl;

  // 1. write version'''
)

inject_once(
    kmer_index,
    '[WASM DEBUG] KmerIndex::BuildDeBruijnGraph: dbg.writeBinary begin',
    '  bool res = dbg.writeBinary(out, opt.threads);',
    '''  std::cerr << "[WASM DEBUG] KmerIndex::BuildDeBruijnGraph: dbg.writeBinary begin" << std::endl;
  bool res = dbg.writeBinary(out, opt.threads);
  std::cerr << "[WASM DEBUG] KmerIndex::BuildDeBruijnGraph: dbg.writeBinary done; result=" << res << std::endl;'''
)

# ---------------------------------------------------------------------------
# CompactedDBG::build -> toDataGraph checkpoints. The observed crash happens
# after the void graph prints "After join", but before KmerIndex gets control
# back, so this conversion is a prime suspect.
# ---------------------------------------------------------------------------
inject_once(
    compacted,
    '[WASM DEBUG] CompactedDBG::build: void graph build returned',
    '''            construct_finished = graph.build(opt);

            if (construct_finished) toDataGraph(std::move(graph), opt.nb_threads);''',
    '''            construct_finished = graph.build(opt);
            std::cerr << "[WASM DEBUG] CompactedDBG::build: void graph build returned=" << construct_finished
                      << " size=" << graph.size() << std::endl;

            if (construct_finished) {
                std::cerr << "[WASM DEBUG] CompactedDBG::build: toDataGraph begin" << std::endl;
                toDataGraph(std::move(graph), opt.nb_threads);
                std::cerr << "[WASM DEBUG] CompactedDBG::build: toDataGraph done; size=" << size() << std::endl;
            }'''
)

# Fine-grained checkpoints inside toDataGraph.
inject_once(
    compacted,
    '[WASM DEBUG] toDataGraph: begin',
    '''CompactedDBG<U, G>& CompactedDBG<U, G>::toDataGraph(CompactedDBG<void, void>&& o, const size_t nb_threads) {

    clear();''',
    '''CompactedDBG<U, G>& CompactedDBG<U, G>::toDataGraph(CompactedDBG<void, void>&& o, const size_t nb_threads) {

    std::cerr << "[WASM DEBUG] toDataGraph: begin threads=" << nb_threads
              << " source_size=" << o.size()
              << " long_unitigs=" << o.v_unitigs.size()
              << " short_unitigs=" << o.km_unitigs.size()
              << " abundant_unitigs=" << o.h_kmers_ccov.size()
              << " minimizers=" << o.hmap_min_unitigs.size() << std::endl;

    clear();
    std::cerr << "[WASM DEBUG] toDataGraph: destination clear done" << std::endl;'''
)

inject_once(
    compacted,
    '[WASM DEBUG] toDataGraph: km_unitigs.toData begin',
    '    km_unitigs.toData(std::move(o.km_unitigs), nb_threads);',
    '''    std::cerr << "[WASM DEBUG] toDataGraph: km_unitigs.toData begin; blocks/source_size="
              << o.km_unitigs.size() << std::endl;
    km_unitigs.toData(std::move(o.km_unitigs), nb_threads);
    std::cerr << "[WASM DEBUG] toDataGraph: km_unitigs.toData done; dest_size="
              << km_unitigs.size() << std::endl;'''
)

inject_once(
    compacted,
    '[WASM DEBUG] toDataGraph: hmap_min_unitigs move begin',
    '    hmap_min_unitigs = std::move(o.hmap_min_unitigs);\n\n    data = wrapperData<G>();',
    '''    std::cerr << "[WASM DEBUG] toDataGraph: hmap_min_unitigs move begin; source_size="
              << o.hmap_min_unitigs.size() << std::endl;
    hmap_min_unitigs = std::move(o.hmap_min_unitigs);
    std::cerr << "[WASM DEBUG] toDataGraph: hmap_min_unitigs move done; dest_size="
              << hmap_min_unitigs.size() << std::endl;

    data = wrapperData<G>();
    std::cerr << "[WASM DEBUG] toDataGraph: wrapperData constructed" << std::endl;'''
)

inject_once(
    compacted,
    '[WASM DEBUG] toDataGraph: long-unitig move begin',
    '''    if ((nb_threads == 1) || (v_unitigs.size() < 1024)) moveUnitigs(0, v_unitigs.size());
    else {''',
    '''    std::cerr << "[WASM DEBUG] toDataGraph: long-unitig move begin; count=" << v_unitigs.size() << std::endl;
    if ((nb_threads == 1) || (v_unitigs.size() < 1024)) moveUnitigs(0, v_unitigs.size());
    else {'''
)

inject_once(
    compacted,
    '[WASM DEBUG] toDataGraph: long-unitig move done',
    '''    o.v_unitigs.clear();

    KmerHashTable<CompressedCoverage_t<void>>::const_iterator it_s = o.h_kmers_ccov.begin();''',
    '''    std::cerr << "[WASM DEBUG] toDataGraph: long-unitig move done" << std::endl;
    o.v_unitigs.clear();

    std::cerr << "[WASM DEBUG] toDataGraph: abundant-unitig conversion begin; count="
              << o.h_kmers_ccov.size() << std::endl;
    KmerHashTable<CompressedCoverage_t<void>>::const_iterator it_s = o.h_kmers_ccov.begin();'''
)

inject_once(
    compacted,
    '[WASM DEBUG] toDataGraph: source clear begin',
    '''    o.h_kmers_ccov.clear();
    o.clear();

    return *this;''',
    '''    std::cerr << "[WASM DEBUG] toDataGraph: abundant-unitig conversion done; dest_count="
              << h_kmers_ccov.size() << std::endl;
    o.h_kmers_ccov.clear();
    std::cerr << "[WASM DEBUG] toDataGraph: source clear begin" << std::endl;
    o.clear();
    std::cerr << "[WASM DEBUG] toDataGraph: done" << std::endl;

    return *this;'''
)

# ---------------------------------------------------------------------------
# KmerCovIndex<void> -> KmerCovIndex<T> conversion checkpoints.
# ---------------------------------------------------------------------------
inject_once(
    kmercov,
    '[WASM DEBUG] KmerCovIndex::toData: begin',
    '''KmerCovIndex<T>& KmerCovIndex<T>::toData(KmerCovIndex<void>&& o, const size_t nb_threads) {

    sz = o.sz;''',
    '''KmerCovIndex<T>& KmerCovIndex<T>::toData(KmerCovIndex<void>&& o, const size_t nb_threads) {

    std::cerr << "[WASM DEBUG] KmerCovIndex::toData: begin source_size=" << o.sz
              << " blocks=" << o.v_blocks.size() << " threads=" << nb_threads << std::endl;
    sz = o.sz;'''
)

inject_once(
    kmercov,
    '[WASM DEBUG] KmerCovIndex::toData: copyBlock begin',
    '''    if ((nb_threads == 1) || (v_blocks.size() < nb_threads)) copyBlock(0, v_blocks.size());
    else {''',
    '''    std::cerr << "[WASM DEBUG] KmerCovIndex::toData: copyBlock begin" << std::endl;
    if ((nb_threads == 1) || (v_blocks.size() < nb_threads)) copyBlock(0, v_blocks.size());
    else {'''
)

inject_once(
    kmercov,
    '[WASM DEBUG] KmerCovIndex::toData: source clear begin',
    '''    o.clear();

    return *this;''',
    '''    std::cerr << "[WASM DEBUG] KmerCovIndex::toData: copyBlock done; dest_blocks=" << v_blocks.size() << std::endl;
    std::cerr << "[WASM DEBUG] KmerCovIndex::toData: source clear begin" << std::endl;
    o.clear();
    std::cerr << "[WASM DEBUG] KmerCovIndex::toData: done" << std::endl;

    return *this;'''
)

# ---------------------------------------------------------------------------
# Serialization checkpoints in case toDataGraph succeeds.
# ---------------------------------------------------------------------------
inject_once(
    io_tcc,
    '[WASM DEBUG] writeBinary: graph begin',
    '''        const bool write_success = writeBinaryGraph(out, nb_threads);

        if (write_success) return writeBinaryIndex(out, checksum(), nb_threads);''',
    '''        std::cerr << "[WASM DEBUG] writeBinary: graph begin" << std::endl;
        const bool write_success = writeBinaryGraph(out, nb_threads);
        std::cerr << "[WASM DEBUG] writeBinary: graph done result=" << write_success << std::endl;

        if (write_success) {
            std::cerr << "[WASM DEBUG] writeBinary: checksum begin" << std::endl;
            const uint64_t wasm_debug_checksum = checksum();
            std::cerr << "[WASM DEBUG] writeBinary: checksum done value=" << wasm_debug_checksum << std::endl;
            std::cerr << "[WASM DEBUG] writeBinary: index begin" << std::endl;
            const bool wasm_debug_index_ok = writeBinaryIndex(out, wasm_debug_checksum, nb_threads);
            std::cerr << "[WASM DEBUG] writeBinary: index done result=" << wasm_debug_index_ok << std::endl;
            return wasm_debug_index_ok;
        }'''
)

print('Applied v6 Wasm debug instrumentation and ASan/UBSan build flags.')
