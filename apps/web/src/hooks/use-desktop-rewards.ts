import "@/lib/api";
import {
  type DesktopRewardsStatus,
  type RewardTaskId,
  type RewardTaskStatus,
  claimDesktopRewardResponseSchema,
  desktopRewardsStatusSchema,
  rewardTasks,
} from "@nexu/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getApiInternalDesktopRewards,
  postApiInternalDesktopRewardsClaim,
} from "../../lib/api/sdk.gen";

export const DESKTOP_REWARDS_QUERY_KEY = ["desktop-rewards"] as const;

function createFallbackRewardsStatus(): DesktopRewardsStatus {
  const tasks: RewardTaskStatus[] = rewardTasks.map((task) => ({
    ...task,
    actionUrl: task.actionUrl ?? null,
    isClaimed: false,
    lastClaimedAt: null,
    claimCount: 0,
  }));

  return {
    viewer: {
      cloudConnected: false,
      activeModelId: null,
      activeModelProviderId: null,
      usingManagedModel: false,
    },
    progress: {
      claimedCount: 0,
      totalCount: tasks.length,
      earnedCredits: 0,
      availableCredits: tasks.reduce((sum, task) => sum + task.reward, 0),
    },
    tasks,
  };
}

async function fetchDesktopRewardsStatus(): Promise<DesktopRewardsStatus> {
  const { data, error } = await getApiInternalDesktopRewards();

  if (error || !data) {
    throw error ?? new Error("Failed to fetch desktop rewards");
  }

  return desktopRewardsStatusSchema.parse(data);
}

async function claimDesktopReward(taskId: RewardTaskId) {
  const { data, error } = await postApiInternalDesktopRewardsClaim({
    body: { taskId },
  });

  if (error || !data) {
    throw error ?? new Error("Failed to claim desktop reward");
  }

  return claimDesktopRewardResponseSchema.parse(data);
}

export function useDesktopRewardsStatus() {
  const queryClient = useQueryClient();
  const rewardsQuery = useQuery({
    queryKey: DESKTOP_REWARDS_QUERY_KEY,
    queryFn: fetchDesktopRewardsStatus,
  });

  const claimMutation = useMutation({
    mutationFn: claimDesktopReward,
    onSuccess: (response) => {
      queryClient.setQueryData(DESKTOP_REWARDS_QUERY_KEY, response.status);
    },
  });

  return {
    status: rewardsQuery.data ?? createFallbackRewardsStatus(),
    loading: rewardsQuery.isLoading,
    refresh: rewardsQuery.refetch,
    claimTask: claimMutation.mutateAsync,
    claimingTaskId: claimMutation.isPending
      ? (claimMutation.variables ?? null)
      : null,
    isClaiming: claimMutation.isPending,
  };
}
