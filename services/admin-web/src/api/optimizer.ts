// 최적화 API 클라이언트 — Admin Server의 optimizer 엔드포인트를 호출한다.
import axios from 'axios';

export interface OptimizerProfile {
  domain: string;
  quality: number;
  max_width: number;
  enabled: boolean;
}

export interface DomainStats {
  domain: string;
  original_bytes: number;
  optimized_bytes: number;
  count: number;
}

export async function fetchOptimizerProfiles(): Promise<{ profiles: OptimizerProfile[] }> {
  const res = await axios.get<{ profiles: OptimizerProfile[] }>('/api/optimizer/profiles');
  return res.data;
}

export async function updateOptimizerProfile(profile: OptimizerProfile): Promise<void> {
  await axios.put(`/api/optimizer/profiles/${encodeURIComponent(profile.domain)}`, {
    quality: profile.quality,
    max_width: profile.max_width,
    enabled: profile.enabled,
  });
}

export async function fetchOptimizationStats(): Promise<{ stats: DomainStats[] }> {
  const res = await axios.get<{ stats: DomainStats[] }>('/api/stats/optimization');
  return res.data;
}
