package org.ceitba.api.service.drive;

import org.ceitba.api.service.media.ObjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Collection;
import java.util.List;

// Best-effort deletion of stored Drive copies. Inside a transaction the
// objects go only after it commits (a rollback keeps rows and objects in
// step); a failed delete is logged and left behind (orphans under drive/
// are harmless: never public, never referenced).
@Component
public class DriveStorageJanitor {

    private static final Logger log = LoggerFactory.getLogger(DriveStorageJanitor.class);

    private final ObjectStorage storage;

    public DriveStorageJanitor(ObjectStorage storage) {
        this.storage = storage;
    }

    public void deleteAfterCommit(Collection<String> keys) {
        if (keys == null || keys.isEmpty()) return;
        var copy = List.copyOf(keys);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    deleteNow(copy);
                }
            });
        } else {
            deleteNow(copy);
        }
    }

    public void deleteNow(Collection<String> keys) {
        for (var key : keys) {
            try {
                storage.delete(key);
            } catch (RuntimeException e) {
                log.warn("Drive sync: could not delete stored object {}: {}", key, e.getMessage());
            }
        }
    }
}
