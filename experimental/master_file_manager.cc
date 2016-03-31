#include "master_file_manager.h"

#include <ctime>
#include <glog/logging.h>

// TODO(peryaudo): Add lock

void MasterFileManager::NotifyFilePut(
    const std::string& file_id, uint64_t size, int worker_id, bool lock) {
  if (files_.count(file_id)) {
    files_[file_id] = FileInfo();

    // TODO(peryaudo): set expire field
  }

  auto&& file_info = files_[file_id];
  file_info.file_size = size;
  file_info.workers.insert(worker_id);
  if (lock) {
    file_info.locked_workers.insert(worker_id);
  }
}

bool MasterFileManager::IsFileAlive(const std::string& file_id) {
  return files_.count(file_id);
}

bool MasterFileManager::LockFiles(
    std::vector<std::string>& file_ids, int worker_id) {
  for (auto&& file_id : file_ids) {
    auto file = files_.find(file_id);
    CHECK(file != files_.end()) << " file does not exist!";
    if (!file->second.workers.count(worker_id)) {
      return false;
    }
    file->second.locked_workers.insert(worker_id);
  }
  return true;
}

void MasterFileManager::UnlockFiles(
    std::vector<std::string>& file_ids, int worker_id) {
  for (auto&& file_id : file_ids) {
    auto file = files_.find(file_id);
    CHECK(file != files_.end()) << " file does not exist!";
    file->second.locked_workers.erase(worker_id);
  }
}

void MasterFileManager::ListMissingFiles(
    int worker_id,
    const std::vector<std::string>& file_ids,
    std::vector<std::string> *missing_file_ids) {
  missing_file_ids->clear();
  for (auto&& file_id : file_ids) {
    auto file = files_.find(file_id);
    CHECK(file != files_.end()) << " file does not exist!";
    if (!file->second.workers.count(worker_id)) {
      missing_file_ids->emplace_back(file_id);
    }
  }
}

int MasterFileManager::GetEmptyWorker() {
  // TODO(peryaudo): Implement. (This is placeholder)

  auto worker_ids = node_manager_.worker_ids();
  if (worker_ids.empty()) {
    return -1;
  } else {
    return worker_ids.front();
  }
}

int MasterFileManager::GetWorkerWithFile(const std::string& file_id) {
  auto file = files_.find(file_id);
  CHECK(file != files_.end()) << " file does not exist!";

  // TODO(peryaudo): Round robbin.
  return *(file->second.workers.begin());
}
