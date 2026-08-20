#!/usr/bin/env python3
"""Apply the isolated fastp 0.23.4 browser gzip portability patch.

The scientific read-processing code remains unchanged. Only the native
ISA-L/libdeflate gzip adapters are replaced by zlib, which Emscripten pins.
Every replacement is exact and fails closed if the upstream source drifts.
"""

from pathlib import Path
import sys


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def patch_fastq_reader(source_root: Path) -> None:
    header_path = source_root / "src" / "fastqreader.h"
    header = header_path.read_text(encoding="utf-8")
    header = replace_once(header, '#include "igzip_lib.h"', '#include <zlib.h>', "reader include")
    header = replace_once(
        header,
        """\tstruct isal_gzip_header mGzipHeader;
\tstruct inflate_state mGzipState;
\tunsigned char *mGzipInputBuffer;
\tunsigned char *mGzipOutputBuffer;
\tsize_t mGzipInputBufferSize;
\tsize_t mGzipOutputBufferSize;
\tsize_t mGzipInputUsedBytes;""",
        """\tgzFile mGzipFile;
\tbool mGzipFinished;""",
        "reader members",
    )
    header_path.write_text(header, encoding="utf-8", newline="\n")

    cpp_path = source_root / "src" / "fastqreader.cpp"
    cpp = cpp_path.read_text(encoding="utf-8")
    cpp = replace_once(
        cpp,
        """#define FQ_BUF_SIZE (1<<23)
#define IGZIP_IN_BUF_SIZE (1<<22)
#define GZIP_HEADER_BYTES_REQ (1<<16)""",
        "#define FQ_BUF_SIZE (1<<23)",
        "reader constants",
    )
    cpp = replace_once(
        cpp,
        """\tmGzipInputBufferSize = IGZIP_IN_BUF_SIZE;
\tmGzipInputBuffer = new unsigned char[mGzipInputBufferSize];
\tmGzipOutputBufferSize = FQ_BUF_SIZE;
\tmGzipOutputBuffer = (unsigned char*)mFastqBuf;""",
        """\tmGzipFile = NULL;
\tmGzipFinished = false;""",
        "reader constructor gzip state",
    )
    cpp = replace_once(cpp, "\tmGzipInputUsedBytes = 0;\n", "", "reader byte counter")
    cpp = replace_once(cpp, "\tdelete[] mGzipInputBuffer;\n", "", "reader input buffer delete")
    cpp = replace_once(
        cpp,
        "return eof() && mGzipState.avail_in == 0;",
        "return mGzipFinished;",
        "reader finished state",
    )

    start = cpp.index("void FastqReader::readToBufIgzip(){")
    end = cpp.index("\nvoid FastqReader::readToBuf()", start)
    cpp = cpp[:start] + """void FastqReader::readToBufIgzip(){
\tint ret = gzread(mGzipFile, mFastqBuf, FQ_BUF_SIZE);
\tif(ret < 0) {
\t\tint errorNumber = Z_OK;
\t\tconst char* message = gzerror(mGzipFile, &errorNumber);
\t\terror_exit("zlib: encountered while decompressing file: " + mFilename + ": " + message);
\t}
\tmBufDataLen = ret;
\tif(ret == 0 || gzeof(mGzipFile))
\t\tmGzipFinished = true;
}
""" + cpp[end:]

    cpp = replace_once(
        cpp,
        """\tif (ends_with(mFilename, ".gz")){
\t\tmFile = fopen(mFilename.c_str(), "rb");
\t\tif(mFile == NULL) {
\t\t\terror_exit("Failed to open file: " + mFilename);
\t\t}
\t\tisal_gzip_header_init(&mGzipHeader);
\t\tisal_inflate_init(&mGzipState);
\t\tmGzipState.crc_flag = ISAL_GZIP_NO_HDR_VER;
\t\tmGzipState.next_in = mGzipInputBuffer;
\t\tmGzipState.avail_in = fread(mGzipState.next_in, 1, mGzipInputBufferSize, mFile);
\t\tmGzipInputUsedBytes += mGzipState.avail_in;
\t\tint ret = isal_read_gzip_header(&mGzipState, &mGzipHeader);
\t\tif (ret != ISAL_DECOMP_OK) {
\t\t\terror_exit("igzip: Error invalid gzip header found: "  + mFilename);
\t\t}
\t\tmZipped = true;
\t}""",
        """\tif (ends_with(mFilename, ".gz")){
\t\tmGzipFile = gzopen(mFilename.c_str(), "rb");
\t\tif(mGzipFile == NULL) {
\t\t\terror_exit("Failed to open file: " + mFilename);
\t\t}
\t\tmZipped = true;
\t}""",
        "reader gzip init",
    )
    cpp = replace_once(
        cpp,
        "bytesRead = mGzipInputUsedBytes - mGzipState.avail_in;",
        """z_off_t offset = gzoffset(mGzipFile);
\t\tbytesRead = offset < 0 ? 0 : static_cast<size_t>(offset);""",
        "reader byte progress",
    )
    cpp = replace_once(
        cpp,
        """bool FastqReader::eof() {
\treturn feof(mFile);//mFile.eof();
}""",
        """bool FastqReader::eof() {
\tif(mZipped)
\t\treturn mGzipFinished;
\telse
\t\treturn feof(mFile);//mFile.eof();
}""",
        "reader eof",
    )
    cpp = replace_once(
        cpp,
        """void FastqReader::close(){
\tif (mFile){""",
        """void FastqReader::close(){
\tif (mGzipFile){
\t\tgzclose(mGzipFile);
\t\tmGzipFile = NULL;
\t}
\tif (mFile){""",
        "reader close",
    )
    cpp_path.write_text(cpp, encoding="utf-8", newline="\n")


def patch_writer(source_root: Path) -> None:
    header_path = source_root / "src" / "writer.h"
    header = header_path.read_text(encoding="utf-8")
    header = replace_once(header, '#include "libdeflate.h"', '#include <zlib.h>', "writer include")
    header = replace_once(
        header,
        "\tlibdeflate_compressor* mCompressor;",
        "\tgzFile mGzipFile;",
        "writer gzip member",
    )
    header_path.write_text(header, encoding="utf-8", newline="\n")

    cpp_path = source_root / "src" / "writer.cpp"
    cpp = cpp_path.read_text(encoding="utf-8")
    cpp = replace_once(
        cpp,
        """\tmFilename = filename;
\tmCompressor = NULL;
\tmZipped = false;""",
        """\tmFilename = filename;
\tmGzipFile = NULL;
\tmZipped = false;
\tmFP = NULL;""",
        "writer constructor",
    )
    cpp = replace_once(
        cpp,
        """\t\tmBufDataLen = 0;
\t}
}""",
        """\t\tmBufDataLen = 0;
\t}
\tif(mZipped && mGzipFile)
\t\tgzflush(mGzipFile, Z_SYNC_FLUSH);
}""",
        "writer flush",
    )
    cpp = replace_once(
        cpp,
        """\tif (ends_with(mFilename, ".gz")){
\t\tmCompressor = libdeflate_alloc_compressor(mCompression);
\t\tif(mCompressor == NULL) {
\t\t\terror_exit("Failed to alloc libdeflate_alloc_compressor, please check the libdeflate library.");
\t\t}
\t\tmZipped = true;
\t\tmFP = fopen(mFilename.c_str(), "wb");
\t\tif(mFP == NULL) {
\t\t\terror_exit("Failed to write: " + mFilename);
\t\t}
\t}""",
        """\tif (ends_with(mFilename, ".gz")){
\t\tmZipped = true;
\t\tmGzipFile = gzopen(mFilename.c_str(), "wb");
\t\tif(mGzipFile == NULL) {
\t\t\terror_exit("Failed to write: " + mFilename);
\t\t}
\t\tif(gzsetparams(mGzipFile, mCompression, Z_DEFAULT_STRATEGY) != Z_OK) {
\t\t\terror_exit("Failed to set gzip compression for: " + mFilename);
\t\t}
\t}""",
        "writer gzip init",
    )
    cpp = replace_once(
        cpp,
        """\tif(mZipped){
\t\tsize_t bound = libdeflate_gzip_compress_bound(mCompressor, size);
\t\tvoid* out = malloc(bound);
\t\tsize_t outsize = libdeflate_gzip_compress(mCompressor, strdata, size, out, bound);
\t\tif(outsize == 0)
\t\t\tstatus = false;
\t\telse {
\t\t\tsize_t ret = fwrite(out, 1, outsize, mFP );
\t\t\tstatus = ret>0;
\t\t\t//mOutStream->write((char*)out, outsize);
\t\t\t//status = !mOutStream->fail();
\t\t}
\t\tfree(out);
\t}""",
        """\tif(mZipped){
\t\tint ret = gzwrite(mGzipFile, strdata, static_cast<unsigned int>(size));
\t\tstatus = ret >= 0 && static_cast<size_t>(ret) == size;
\t}""",
        "writer gzip write",
    )
    cpp = replace_once(
        cpp,
        """\tif (mZipped){
\t\tif (mCompressor){
\t\t\tlibdeflate_free_compressor(mCompressor);
\t\t\tmCompressor = NULL;
\t\t}
\t}""",
        """\tif (mZipped){
\t\tif (mGzipFile){
\t\t\tgzclose(mGzipFile);
\t\t\tmGzipFile = NULL;
\t\t}
\t}""",
        "writer gzip close",
    )
    cpp_path.write_text(cpp, encoding="utf-8", newline="\n")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: apply-wasm-port.py <fastp-source-root>")
    source_root = Path(sys.argv[1]).resolve()
    patch_fastq_reader(source_root)
    patch_writer(source_root)
    print(f"Applied fastp 0.23.4 Wasm zlib portability patch to {source_root}")


if __name__ == "__main__":
    main()
