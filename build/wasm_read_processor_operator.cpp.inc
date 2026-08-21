void ReadProcessor::operator()() {
#ifdef __EMSCRIPTEN__
  const auto web_thread_started = std::chrono::steady_clock::now();
  auto finish_web_stats = [&]() {
    web_total_us = std::chrono::duration_cast<std::chrono::microseconds>(
                       std::chrono::steady_clock::now() - web_thread_started)
                       .count();
    reportWebThreadStats();
  };
#endif
  while (true) {
    int readbatch_id;
    // grab the reader lock
    if (mp.opt.batch_mode) {
      if (batchSR.empty()) {
#ifdef __EMSCRIPTEN__
        finish_web_stats();
#endif
        return;
      } else {
#ifdef __EMSCRIPTEN__
        const auto fetch_started = std::chrono::steady_clock::now();
#endif
        batchSR.fetchSequences(buffer, bufsize, seqs, names, quals, flags, umis, readbatch_id,
                               mp.opt.pseudobam);
#ifdef __EMSCRIPTEN__
        web_fetch_us += std::chrono::duration_cast<std::chrono::microseconds>(
                            std::chrono::steady_clock::now() - fetch_started)
                            .count();
#endif
      }
    } else {
#ifdef __EMSCRIPTEN__
      const auto wait_started = std::chrono::steady_clock::now();
#endif
      std::unique_lock<std::mutex> lock(mp.reader_lock);
#ifdef __EMSCRIPTEN__
      web_reader_wait_us += std::chrono::duration_cast<std::chrono::microseconds>(
                                std::chrono::steady_clock::now() - wait_started)
                                .count();
#endif
      if (mp.SR->empty()) {
        // nothing to do
#ifdef __EMSCRIPTEN__
        lock.unlock();
        finish_web_stats();
#endif
        return;
      } else {
        // get new sequences
#ifdef __EMSCRIPTEN__
        const auto fetch_started = std::chrono::steady_clock::now();
        if (paired && mp.opt.threads > 1 && !mp.opt.pseudobam && !mp.opt.fusion &&
            !mp.opt.bam) {
          static_cast<FastqSequenceReader *>(mp.SR)->fetchPairedSequencesParallel(
              buffer, bufsize, seqs, flags, readbatch_id);
        } else {
#endif
        mp.SR->fetchSequences(buffer, bufsize, seqs, names, quals, flags, umis, readbatch_id,
                              mp.opt.pseudobam || mp.opt.fusion);
#ifdef __EMSCRIPTEN__
        }
        web_fetch_us += std::chrono::duration_cast<std::chrono::microseconds>(
                            std::chrono::steady_clock::now() - fetch_started)
                            .count();
#endif
      }

      // release the reader lock
    }
    pseudobatch.aln.clear();
    pseudobatch.batch_id = readbatch_id;
    // process our sequences
#ifdef __EMSCRIPTEN__
    const auto process_started = std::chrono::steady_clock::now();
#endif
    processBuffer();
#ifdef __EMSCRIPTEN__
    web_process_us += std::chrono::duration_cast<std::chrono::microseconds>(
                          std::chrono::steady_clock::now() - process_started)
                          .count();
    const auto update_started = std::chrono::steady_clock::now();
#endif

    // update the results, MP acquires the lock
    std::vector<BUSData> tmp_v{};
    const size_t reads_in_batch = paired ? seqs.size() / 2 : seqs.size();
    mp.update(counts, newEcs, ec_umi, new_ec_umi, reads_in_batch, flens, unmapped_list, flens_lr,
              flens_lr_c, bias5, pseudobatch, tmp_v,
              std::vector<std::pair<BUSData, Roaring>>{}, nullptr, nullptr, id, local_id);
#ifdef __EMSCRIPTEN__
    web_update_us += std::chrono::duration_cast<std::chrono::microseconds>(
                         std::chrono::steady_clock::now() - update_started)
                         .count();
    web_batches++;
    web_reads += reads_in_batch;
#endif
    clear();
  }
}

#ifdef __EMSCRIPTEN__
void ReadProcessor::reportWebThreadStats() {
  if (web_stats_reported) {
    return;
  }
  web_stats_reported = true;
  std::lock_guard<std::mutex> lock(mp.writer_lock);
  std::cerr << "[WEBPERF] worker_stats id=" << local_id << " batches=" << web_batches
            << " reads=" << web_reads << " reader_wait_us=" << web_reader_wait_us
            << " fetch_us=" << web_fetch_us << " process_us=" << web_process_us
            << " update_us=" << web_update_us << " total_us=" << web_total_us << std::endl;
}
#endif
