#include "node_manager.h"

#include <glog/logging.h>

void NodeManager::AddWorkersFromString(const std::string& addresses) {
  std::string address;
  for (int i = 0; i < addresses.size(); ++i) {
    if (addresses[i] != ',') {
      address += addresses[i];
    }

    if (addresses[i] == ',' ||
        i == addresses.size() - 1) {
      AddWorker(address);
      address.clear();
    }
  }
}

std::vector<int> NodeManager::worker_ids() {
  std::vector<int> worker_ids;
  for (auto&& worker : workers_) {
    worker_ids.push_back(worker.first);
  }
  return worker_ids;
}

int NodeManager::AddWorker(const std::string& address) {
  LOG(INFO) << "worker added: " << address;
  // TODO(peryaudo): lock worker_cnt_
  const int worker_id = worker_cnt_++;
  workers_.emplace(worker_id, address);
  return worker_id;
}

const std::string& NodeManager::GetWorkerAddress(int worker_id) {
  auto worker = workers_.find(worker_id);
  CHECK(worker != workers_.end()) << " worker id does not exist!";
  return worker->second.address;
}

std::shared_ptr<francine::FrancineWorker::Stub>
NodeManager::GetWorkerStub(int worker_id) {
  auto worker = workers_.find(worker_id);
  CHECK(worker != workers_.end()) << " worker id does not exist!";
  return worker->second.stub;
}
