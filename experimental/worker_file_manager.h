#ifndef FRANCINE_WORKER_FILE_MANAGER_H_
#define FRANCINE_WORKER_FILE_MANAGER_H_

#include <string>
#include <unordered_map>
#include <mutex>
#include <vector>

class WorkerFileManager {
 public:
  WorkerFileManager() : tmp_cnt_(0) {
  }

  // Returns true if failed.
  // All the function calls to this class are thread-safe.

  // TODO(peryaudo): create streaming version of Get()
  bool Get(const std::string& id, std::string *content);
  bool Put(const std::string& content, std::string *id);
  bool Delete(const std::string& id);

  // Retain a renderer created file.
  bool Retain(const std::string dirname,
              const std::string& filename, std::string *id);

  using Id = std::string;
  using Alias = std::string;
  bool CreateTmpDir(
      const std::vector<std::pair<Id, Alias>>& files,
      std::string *dirname);
  void RemoveTmpDir(const std::string& dirname);

 private:
  std::unordered_map<std::string, std::string> inmemory_files_;
  std::mutex mutex_;
  int tmp_cnt_;
};

#endif
