#include "worker_file_manager.h"

#include <fstream>
#include <gflags/gflags.h>
#include <glog/logging.h>
#include <tuple>
#include <sys/stat.h>
#include <unistd.h>

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

bool WorkerFileManager::Put(const std::string& content,
                            std::string *id, uint64_t *size) {
  std::lock_guard<std::mutex> lock(mutex_);

  std::string hash;
  picosha2::hash256_hex_string(content, hash);
  *id = hash;
  *size = content.size();

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

bool WorkerFileManager::Retain(
    const std::string dirname,
    const std::string& filename, std::string *id, uint64_t *size) {
  // Do not acquire lock here.

  std::ifstream ifs(dirname + "/" + filename);
  if (ifs.good()) {
    std::string content((std::istreambuf_iterator<char>(ifs)),
        std::istreambuf_iterator<char>());
    return Put(content, id, size);
  }

  return true;
}

bool WorkerFileManager::CreateTmpDir(
    const std::vector<std::pair<Id, Alias>>& files,
    std::string *dirname) {
  std::lock_guard<std::mutex> lock(mutex_);

  std::stringstream tmp_dir_name;
  tmp_dir_name<<FLAGS_tmpdir<<"/"<<tmp_cnt_;
  *dirname = tmp_dir_name.str();
  ++tmp_cnt_;

  if (!mkdir(dirname->c_str(), 0755)) {
    LOG(ERROR) << "failed to create tmpdir " << *dirname;
    return false;
  }

  for (auto&& file : files) {
    std::string id, alias;
    std::tie(id, alias) = file;

    if (inmemory_files_.count(id)) {
      // Spill out in memory file to disk.
      std::string content = inmemory_files_[id];
      inmemory_files_.erase(id);

      std::ofstream ofs(FLAGS_tmpdir + "/" + id);
      ofs << content;
    }

    const auto from = FLAGS_tmpdir + "/" + id;
    const auto to = *dirname + "/" + alias;

    if (!symlink(from.c_str(), to.c_str())) {
      LOG(ERROR) << "symlink failed. Id: " << id << " Alias: " << alias;
      RemoveTmpDir(*dirname);
      return true;
    }
  }

  return false;
}

void WorkerFileManager::RemoveTmpDir(const std::string& dirname) {
  // Do not acquire lock here.
  std::string cmd = "rm - rf ";
  cmd += dirname;
  system(dirname.c_str());
}
