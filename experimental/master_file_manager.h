#ifndef FRANCINE_MASTER_FILE_MANAGER_H_
#define FRANCINE_MASTER_FILE_MANAGER_H_

#include <ctime>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <algorithm>

#include "node_manager.h"

class MasterFileManager {
 public:
  MasterFileManager(NodeManager& node_manager) : node_manager_(node_manager) {
  }

  // Notify the file is put on the node.
  // If file didn't exist previously, it sets new expiration time.
  // Set lock = true to lock the file right after the file is uploaded.
  void NotifyFilePut(const std::string& file_id,
                     uint64_t size, int worker_id, bool lock);
  // Notify the file is deleted on the node.
  void NotifyFileDeleted(const std::string& file_id, int worker_id);
  // Notify the worker is removed.
  void NotifyWorkerRemoved(int worker_id);

  // Explicitly expire the file so that it will be removed in the future.
  void ExpireFile(const std::string& file_id);
  // Check if the file is not expired.
  bool IsFileAlive(const std::string& file_id);

  // Lock / Unlock certain files on the worker.
  // The files on the worker will not be listed on unused files until they are unlocked.
  // Returns true if the lock acquisition is successful.
  // Ignores if a file is already locked on the worker.
  bool LockFiles(std::vector<std::string>& file_ids, int worker_id);

  // Ignores files that are not on the worker.
  void UnlockFiles(std::vector<std::string>& file_ids, int worker_id);

  // List missing files on the worker to perform the task.
  void ListMissingFiles(int worker_id,
      const std::vector<std::string>& file_ids,
      std::vector<std::string> *missing_file_ids);

  // TODO(peryaudo): Provide better information of workers
  // so that optimal decision of scheduling policy can be easily made.

  // Get the best worker to transfer the file from.
  // Returns -1 if not available.
  int GetWorkerWithFile(const std::string& file_id);
  // Get the most empty worker.
  // Returns -1 if not available.
  int GetEmptyWorker();

  using FileId = std::string;
  using WorkerId = int;

  // List unused files.
  void GetUnusedFiles(std::vector<std::pair<FileId, WorkerId>> *files);

 private:
  NodeManager& node_manager_;

  struct FileInfo {
    time_t expire;
    uint64_t file_size;
    std::unordered_set<int> workers;
    std::unordered_set<int> locked_workers;
  };
  std::unordered_map<FileId, FileInfo> files_;
};

#endif
