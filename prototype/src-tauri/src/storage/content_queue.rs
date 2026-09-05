use super::*;

#[derive(Debug, Default)]
pub(super) struct ContentSyncQueue {
    pub(super) latest_revision: Option<u64>,
    pub(super) pending: Option<PendingContentSync>,
    pub(super) running: bool,
}

#[derive(Debug)]
pub(super) struct PendingContentSync {
    pub(super) epoch: u64,
    pub(super) source_revision: u64,
    pub(super) entries: Vec<filesystem::IndexEntry>,
}

impl ContentIndexState {
    pub(crate) fn enqueue_sync(
        &self,
        source_revision: u64,
        entries: Vec<filesystem::IndexEntry>,
    ) -> bool {
        let Ok(mut queue) = self.sync_queue.lock() else {
            return false;
        };
        if queue
            .latest_revision
            .is_some_and(|latest| source_revision <= latest)
        {
            return false;
        }
        queue.latest_revision = Some(source_revision);
        queue.pending = Some(PendingContentSync {
            epoch: self.mutation_epoch.load(Ordering::Acquire),
            source_revision,
            entries,
        });
        if queue.running {
            false
        } else {
            queue.running = true;
            true
        }
    }

    pub(crate) fn take_pending_sync(&self) -> Option<(u64, Vec<filesystem::IndexEntry>, u64)> {
        self.sync_queue.lock().ok().and_then(|mut queue| {
            queue
                .pending
                .take()
                .map(|pending| (pending.source_revision, pending.entries, pending.epoch))
        })
    }

    pub(crate) fn has_pending_sync_after(&self, source_revision: u64) -> bool {
        self.sync_queue
            .lock()
            .ok()
            .and_then(|queue| {
                queue
                    .pending
                    .as_ref()
                    .map(|pending| pending.source_revision)
            })
            .is_some_and(|pending_revision| pending_revision > source_revision)
    }

    pub(crate) fn finish_sync_worker(&self) -> bool {
        let Ok(mut queue) = self.sync_queue.lock() else {
            return false;
        };
        if queue.pending.is_some() {
            true
        } else {
            queue.running = false;
            false
        }
    }
}
