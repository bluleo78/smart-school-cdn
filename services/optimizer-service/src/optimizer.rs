/// Optimizer 핵심 로직 — 이미지 변환 + 텍스트 압축 + SQLite 프로파일/통계 DB
pub struct OptimizerDb;

impl OptimizerDb {
    pub fn open(_path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self)
    }
}
