#ifndef FRANCINE_NODE_MANAGER_H_
#define FRANCINE_NODE_MANAGER_H_

#include <vector>

class NodeManager {
 public:

  const std::vector<int> &workers();
  int AddWorker();
  void RemoveWorker(int worker_id);
};

#endif
