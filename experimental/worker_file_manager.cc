#include "worker_file_manager.h"

#include <fstream>
#include <gflags/gflags.h>
#include <glog/logging.h>

#include "picosha2.h"

DEFINE_string(tmpdir, "/tmp", "temporary directory to store files");
DEFINE_int64(inmemory_threshold, 0, "temporary directory to store files");

bool WorkerFileManager::Get(const std::string& id, std::string *content) {
  std::lock_guard<std::mutex> lock(mutex_);

  if (inmemory_files_.count(id)) {
    *content = inmemory_files_[id];
    return false;
  }

  std::ifstream ifs(FLAGS_tmpdir + "/" + id);
  if (ifs.good()) {
    *content = std::string((std::istreambuf_iterator<char>(ifs)),
        std::istreambuf_iterator<char>());
    return false;
  }

  return true;
}

bool WorkerFileManager::Put(const std::string& content, std::string *id) {
  std::lock_guard<std::mutex> lock(mutex_);

  std::string hash;
  picosha2::hash256_hex_string(content, hash);
  *id = hash;

  if (content.size() > FLAGS_inmemory_threshold) {
    std::ofstream ofs(FLAGS_tmpdir + "/" + hash);
    ofs << content;
  } else {
    inmemory_files_[hash] = content;
  }

  return false;
}

bool WorkerFileManager::Delete(const std::string& id) {
  std::lock_guard<std::mutex> lock(mutex_);

  if (inmemory_files_.count(id)) {
    inmemory_files_.erase(id);
    LOG(INFO) << "inmemory file deleted";
    return false;
  }

  const std::string filename = FLAGS_tmpdir + '/' + id;

  if (!remove(filename.c_str())) {
    LOG(INFO) << "on disk file deleted";
    return false;
  }

  return true;
}

/*
if (!mkdir(tmp_dir_name.str().c_str(), 0755)) {
  LOG(ERROR) << "failed to create temporary directory";
  return Status(grpc::INTERNAL, "");
}
*/
