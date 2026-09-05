//! 最多一个扫描和一个等待任务；新请求取消旧查询，许可随任务退出释放。
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{Duration, Instant},
};

use super::{content_index::ContentIndexError, content_limits::valid_id};

const MAX_OUTSTANDING: usize = 2;
const QUERY_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Default)]
pub struct ContentQueryPool {
    requests: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    scan_lock: Arc<Mutex<()>>,
}

pub struct ContentQueryTicket {
    pool: ContentQueryPool,
    id: String,
    cancelled: Arc<AtomicBool>,
    started: Instant,
}

impl ContentQueryPool {
    pub fn begin(&self, id: &str) -> Result<ContentQueryTicket, ContentIndexError> {
        if !valid_id(id) {
            return Err(ContentIndexError::InvalidQuery);
        }
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| ContentIndexError::Unavailable)?;
        if requests.contains_key(id) {
            return Err(ContentIndexError::InvalidQuery);
        }
        for cancelled in requests.values() {
            cancelled.store(true, Ordering::Release);
        }
        if requests.len() >= MAX_OUTSTANDING {
            return Err(ContentIndexError::Busy);
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        requests.insert(id.to_string(), cancelled.clone());
        Ok(ContentQueryTicket {
            pool: self.clone(),
            id: id.to_string(),
            cancelled,
            started: Instant::now(),
        })
    }

    pub fn cancel(&self, id: &str) -> Result<(), ContentIndexError> {
        if !valid_id(id) {
            return Err(ContentIndexError::InvalidQuery);
        }
        let requests = self
            .requests
            .lock()
            .map_err(|_| ContentIndexError::Unavailable)?;
        if let Some(cancelled) = requests.get(id) {
            cancelled.store(true, Ordering::Release);
        }
        Ok(())
    }

    pub fn cancel_all(&self) {
        if let Ok(requests) = self.requests.lock() {
            for cancelled in requests.values() {
                cancelled.store(true, Ordering::Release);
            }
        }
    }
}

impl ContentQueryTicket {
    pub fn check(&self) -> Result<(), ContentIndexError> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err(ContentIndexError::Cancelled);
        }
        if self.started.elapsed() >= QUERY_TIMEOUT {
            return Err(ContentIndexError::TimedOut);
        }
        Ok(())
    }

    pub fn acquire_scan(&self) -> Result<MutexGuard<'_, ()>, ContentIndexError> {
        let guard = self
            .pool
            .scan_lock
            .lock()
            .map_err(|_| ContentIndexError::Unavailable)?;
        self.check()?;
        Ok(guard)
    }
}

impl Drop for ContentQueryTicket {
    fn drop(&mut self) {
        if let Ok(mut requests) = self.pool.requests.lock() {
            requests.remove(&self.id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_scans_and_cancels_a_waiter_without_releasing_its_slot_early() {
        let pool = ContentQueryPool::default();
        let first = pool.begin("first").unwrap();
        let guard = first.acquire_scan().unwrap();
        let second = pool.begin("second").unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let waiting = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            matches!(second.acquire_scan(), Err(ContentIndexError::Cancelled))
        });
        started_rx.recv().unwrap();
        assert!(pool.scan_lock.try_lock().is_err());
        pool.cancel("second").unwrap();
        assert!(matches!(
            pool.begin("overflow"),
            Err(ContentIndexError::Busy)
        ));
        drop(guard);
        assert!(waiting.join().unwrap());
        drop(first);
        assert!(pool.begin("next").is_ok());
    }

    #[test]
    fn bounds_admission_cancellation_timeout_and_releases_permits() {
        let pool = ContentQueryPool::default();
        let first = pool.begin("first").unwrap();
        let second = pool.begin("second").unwrap();
        assert!(matches!(first.check(), Err(ContentIndexError::Cancelled)));
        assert!(matches!(pool.begin("third"), Err(ContentIndexError::Busy)));
        drop(first);
        drop(second);
        let mut next = pool.begin("third").unwrap();
        next.started = Instant::now() - QUERY_TIMEOUT;
        assert!(matches!(next.check(), Err(ContentIndexError::TimedOut)));
        pool.cancel("third").unwrap();
        assert!(matches!(next.check(), Err(ContentIndexError::Cancelled)));
        drop(next);
        assert!(pool.requests.lock().unwrap().is_empty());
    }
}
