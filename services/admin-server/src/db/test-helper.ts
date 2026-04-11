import Database from 'better-sqlite3';
import { DOMAIN_SCHEMA } from './domain-repo.js';

/**
 * 테스트 전용 인메모리 SQLite DB 생성
 * - 매 호출마다 완전히 새로운 :memory: 인스턴스를 반환하므로 테스트 간 격리가 보장된다.
 * - 실제 SQL을 돌려 검증하므로 Spring @Transactional 롤백 테스트와 동일한 "DB 레벨" 안정감을 얻는다.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  // 외래키 제약 활성화 (SQLite 기본값이 꺼져 있음)
  db.pragma('foreign_keys = ON');
  // 프로덕션 스키마를 그대로 적용 — 새 테이블을 추가할 때는 여기도 함께 늘린다
  db.exec(DOMAIN_SCHEMA);
  return db;
}
