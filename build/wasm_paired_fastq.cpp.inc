#ifdef __EMSCRIPTEN__
void FastqSequenceReader::startPairedReaderHelper() {
  if (paired_reader_helper.joinable()) {
    return;
  }
  paired_reader_stop = false;
  paired_reader_task_ready = false;
  paired_reader_task_done = false;
  paired_reader_helper = std::thread([this]() {
    while (true) {
      std::function<void()> task;
      {
        std::unique_lock<std::mutex> lock(paired_reader_helper_mutex);
        paired_reader_helper_cv.wait(lock, [this]() {
          return paired_reader_task_ready || paired_reader_stop;
        });
        if (paired_reader_stop && !paired_reader_task_ready) {
          return;
        }
        task = std::move(paired_reader_task);
        paired_reader_task_ready = false;
      }
      task();
      {
        std::lock_guard<std::mutex> lock(paired_reader_helper_mutex);
        paired_reader_task_done = true;
      }
      paired_reader_done_cv.notify_one();
    }
  });
}

void FastqSequenceReader::stopPairedReaderHelper() {
  if (!paired_reader_helper.joinable()) {
    return;
  }
  {
    std::lock_guard<std::mutex> lock(paired_reader_helper_mutex);
    paired_reader_stop = true;
  }
  paired_reader_helper_cv.notify_one();
  paired_reader_helper.join();
  paired_reader_stop = false;
}

void FastqSequenceReader::beginPairedReaderTask(const std::function<void()>& task) {
  if (!paired_reader_helper.joinable()) {
    task();
    paired_reader_task_done = true;
    return;
  }
  std::lock_guard<std::mutex> lock(paired_reader_helper_mutex);
  paired_reader_task = task;
  paired_reader_task_done = false;
  paired_reader_task_ready = true;
  paired_reader_helper_cv.notify_one();
}

void FastqSequenceReader::waitPairedReaderTask() {
  if (!paired_reader_helper.joinable()) {
    return;
  }
  std::unique_lock<std::mutex> lock(paired_reader_helper_mutex);
  paired_reader_done_cv.wait(lock, [this]() { return paired_reader_task_done; });
}

// Normal paired-end quant can decompress its two independent gzip streams in
// parallel without changing read order. The caller still holds reader_lock,
// and pseudoalignment remains outside that lock. One mate is decoded on the
// calling ReadProcessor pthread and the other on one bounded pool pthread.
bool FastqSequenceReader::fetchPairedSequencesParallel(
    char *buf, const int limit, std::vector<std::pair<const char *, int>> &seqs,
    std::vector<uint32_t> &flags, int &read_id) {
  if (!paired || nfiles != 2 || interleave_nfiles != 0 || limit < 4) {
    std::vector<std::pair<const char *, int>> names;
    std::vector<std::pair<const char *, int>> quals;
    std::vector<std::string> umis;
    return fetchSequences(buf, limit, seqs, names, quals, flags, umis, read_id, false, false);
  }

  readbatch_id += 1;
  read_id = readbatch_id;
  seqs.clear();
  flags.clear();

  const int lane_capacity = limit / 2;
  while (true) {
    if (!state) {
      if (current_file >= files.size()) {
        return false;
      }
      if (current_file + 1 >= files.size()) {
        std::cerr << "Error: paired-end input is missing its Read 2 file" << std::endl;
        exit(1);
      }
      for (int i = 0; i < 2; i++) {
        if (fp[i]) {
          gzclose(fp[i]);
          fp[i] = nullptr;
        }
        if (seq[i]) {
          kseq_destroy(seq[i]);
          seq[i] = nullptr;
        }
        fp[i] = gzopen(files[current_file + i].c_str(), "r");
        if (!fp[i]) {
          std::cerr << "Error: could not open input file " << files[current_file + i]
                    << std::endl;
          exit(1);
        }
        if (gzbuffer(fp[i], KALLISTO_WEB_GZIP_BUFFER_BYTES) != 0) {
          std::cerr << "[~warn] could not set 1 MiB gzip input buffer for "
                    << files[current_file + i] << std::endl;
        }
        seq[i] = kseq_init(fp[i]);
      }
      beginPairedReaderTask([&]() { l[1] = kseq_read(seq[1]); });
      l[0] = kseq_read(seq[0]);
      waitPairedReaderTask();
      current_file += 2;
      state = true;
    }

    std::vector<std::pair<const char *, int>> lane_records[2];
    lane_records[0].reserve(static_cast<size_t>(lane_capacity / 128));
    lane_records[1].reserve(static_cast<size_t>(lane_capacity / 128));
    int lane_used[2] = {0, 0};
    bool oversized[2] = {false, false};

    auto fill_lane = [&](int lane) {
      char *lane_buf = buf + lane * lane_capacity;
      auto &records = lane_records[lane];
      auto &pending = paired_pending[lane];

      while (!pending.empty()) {
        const int length = static_cast<int>(pending.front().size());
        if (length + 1 > lane_capacity - lane_used[lane]) {
          oversized[lane] = records.empty();
          return;
        }
        char *dest = lane_buf + lane_used[lane];
        memcpy(dest, pending.front().data(), length);
        dest[length] = '\0';
        lane_used[lane] += length + 1;
        records.emplace_back(dest, length);
        pending.pop_front();
      }

      while (l[lane] >= 0) {
        const int length = l[lane];
        if (length + 1 > lane_capacity - lane_used[lane]) {
          oversized[lane] = records.empty();
          return;
        }
        char *dest = lane_buf + lane_used[lane];
        memcpy(dest, seq[lane]->seq.s, length + 1);
        lane_used[lane] += length + 1;
        records.emplace_back(dest, length);
        l[lane] = kseq_read(seq[lane]);
      }
    };

    beginPairedReaderTask([&]() { fill_lane(1); });
    fill_lane(0);
    waitPairedReaderTask();

    if (oversized[0] || oversized[1]) {
      std::cerr << "Error: a FASTQ record exceeds the bounded paired read buffer" << std::endl;
      exit(1);
    }
    if (l[0] < -1 || l[1] < -1) {
      std::cerr << "Error: malformed or truncated FASTQ record" << std::endl;
      exit(1);
    }

    const size_t pair_count = std::min(lane_records[0].size(), lane_records[1].size());
    for (int lane = 0; lane < 2; lane++) {
      auto &records = lane_records[lane];
      auto &pending = paired_pending[lane];
      for (size_t i = records.size(); i > pair_count; --i) {
        const auto &record = records[i - 1];
        pending.emplace_front(record.first, static_cast<size_t>(record.second));
      }
    }

    seqs.reserve(pair_count * 2);
    flags.reserve(pair_count);
    for (size_t i = 0; i < pair_count; i++) {
      seqs.push_back(lane_records[0][i]);
      seqs.push_back(lane_records[1][i]);
      numreads++;
      flags.push_back(numreads - 1);
    }

    const bool r1_done = l[0] == -1 && paired_pending[0].empty();
    const bool r2_done = l[1] == -1 && paired_pending[1].empty();
    if (r1_done != r2_done) {
      std::cerr << "Error: paired-end FASTQ files contain different numbers of reads"
                << std::endl;
      exit(1);
    }
    if (r1_done && r2_done) {
      state = false;
    }
    if (pair_count != 0) {
      return true;
    }
    if (!(r1_done && r2_done)) {
      std::cerr << "Error: paired FASTQ reader made no progress" << std::endl;
      exit(1);
    }
    // Both files ended without yielding data. Continue with the next lane pair,
    // or return false if this was the final input pair.
  }
}
#endif
