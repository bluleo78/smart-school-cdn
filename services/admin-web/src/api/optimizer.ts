// 최적화 API 클라이언트 함수
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
  const res = await fetch('/api/optimizer/profiles');
  if (!res.ok) throw new Error('Failed to fetch profiles');
  return res.json();
}

export async function updateOptimizerProfile(profile: OptimizerProfile): Promise<void> {
  const res = await fetch(`/api/optimizer/profiles/${encodeURIComponent(profile.domain)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quality: profile.quality,
      max_width: profile.max_width,
      enabled: profile.enabled,
    }),
  });
  if (!res.ok) throw new Error('Failed to update profile');
}

export async function fetchOptimizationStats(): Promise<{ stats: DomainStats[] }> {
  const res = await fetch('/api/stats/optimization');
  if (!res.ok) throw new Error('Failed to fetch optimization stats');
  return res.json();
}
