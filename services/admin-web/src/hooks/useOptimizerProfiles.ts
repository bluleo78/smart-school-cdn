/// 최적화 프로파일 목록을 조회하는 TanStack Query 훅
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchOptimizerProfiles, updateOptimizerProfile, type OptimizerProfile } from '../api/optimizer';

export function useOptimizerProfiles() {
  return useQuery({
    queryKey: ['optimizer', 'profiles'],
    queryFn: fetchOptimizerProfiles,
  });
}

export function useUpdateOptimizerProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: OptimizerProfile) => updateOptimizerProfile(profile),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['optimizer', 'profiles'] });
    },
  });
}
