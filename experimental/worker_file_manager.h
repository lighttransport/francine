#ifndef FRANCINE_WORKER_FILE_MANAGER_H_
#define FRANCINE_WORKER_FILE_MANAGER_H_

#include <string>
#include <unordered_map>
#include <mutex>

class WorkerFileManager {
 public:
  WorkerFileManager() {
  }

  // Returns true if failed.
  // All the function calls to this class are thread-safe.

  bool Get(const std::string& id, std::string *content);
  bool Put(const std::string& content, std::string *id);
  bool Delete(const std::string& id);

  // TODO(peryaudo): create / remove symbolic links

 private:
  std::unordered_map<std::string, std::string> inmemory_files_;
  std::mutex mutex_;
  int cnt_;
};

#endif
