#ifndef FRANCINE_MASTER_FILE_MANAGER_H_
#define FRANCINE_MASTER_FILE_MANAGER_H_

#include <string>
#include <vector>
#include <algorithm>

class MasterFileManager {
 public:
  MasterFileManager() {
  }

  // Notify the file is put on the node. If file didn't exist, it sets new expiration time.
  void NotifyFilePut(const std::string& file_id, uint64_t size, int worker_id);

  // Notify the file is deleted on the node.
  void NotifyFileDeleted(const std::string& file_id, int worker_id);

  // Notify the worker is removed.
  void NotifyWorkerRemoved(int worker_id);

  // Explicitly expire the file so that it will be removed in the future.
  void ExpireFile(const std::string& file_id);

  // Lock / Unlock certain files on the worker. The files will not be listed on
  // unused files until they are unlocked.
  void LockFiles(std::vector<std::string>& file_ids, int worker_id);
  void UnlockFiles(std::vector<std::string>& file_ids, int worker_id);

  // List missing files on the worker to perform the task.
  void ListMissingFiles(int worker_id,
      const std::vector<std::string>& file_ids,
      std::vector<std::string> *missing_file_ids);

  // Get the best worker to transfer the file from.
  int GetWorkerWithFile(const std::string& file_id);

  // Get the most empty worker.
  int GetEmptyWorker();

  // List unused files.
  using FileId = std::string;
  using WorkerId = int;
  void GetUnusedFiles(std::vector<std::pair<FileId, WorkerId>> *files);
};

#endif
