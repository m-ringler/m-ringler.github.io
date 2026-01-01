// SPDX-FileCopyrightText: 2025 Moritz Ringler
//
// SPDX-License-Identifier: GPL-3.0-or-later
export class GameHistory {
    maxNumberOfStoredGames;
    storagePrefix;
    versionKey;
    generatePrefix;
    storage;
    constructor(storage, maxNumberOfStoredGames = 50, storagePrefix = 'history.', versionKey = 'version', generatePrefix = 'generate.') {
        if (!storagePrefix) {
            throw new Error('storagePrefix must not be empty');
        }
        if (!versionKey) {
            throw new Error('versionKey must not be empty');
        }
        if (!generatePrefix) {
            throw new Error('generatePrefix must not be empty');
        }
        this.storage = storage;
        this.maxNumberOfStoredGames = maxNumberOfStoredGames;
        this.storagePrefix = storagePrefix;
        this.versionKey = versionKey;
        this.generatePrefix = generatePrefix;
    }
    saveGameState(key, game) {
        this.migrate();
        const gameState = {
            timestamp: Date.now(),
            data: game.dumpState(),
        };
        const gameStateString = JSON.stringify(gameState);
        this.storage.setItem(this.storagePrefix + key, gameStateString);
        this.ensureStorageLimit();
    }
    async restoreGameStateAsync(key, game) {
        this.migrate();
        const savedGameState = this.loadGameStateData(this.storagePrefix + key);
        if (savedGameState) {
            await game.restoreStateAsync(savedGameState.data);
            // We use the last modification timme, if we do not have stored
            // information about the time the game was created
            if (game.created > savedGameState.timestamp) {
                game.created = savedGameState.timestamp;
            }
        }
    }
    getLatestGameKey() {
        this.migrate();
        const prefixedKeys = this.getPrefixedHistoryKeys();
        let latestKey = null;
        let latestTimestamp = 0;
        prefixedKeys.forEach((prefixedKey) => {
            const gameState = this.loadGameStateData(prefixedKey);
            if (gameState && gameState.timestamp > latestTimestamp) {
                latestTimestamp = gameState.timestamp;
                latestKey = prefixedKey.substring(this.storagePrefix.length);
            }
        });
        return latestKey;
    }
    getAllSavedGames() {
        this.migrate();
        const prefixedKeys = this.getPrefixedHistoryKeys();
        const result = [];
        prefixedKeys.forEach((prefixedKey) => {
            const gameState = this.loadGameStateData(prefixedKey);
            if (gameState) {
                result.push({
                    key: prefixedKey.substring(this.storagePrefix.length),
                    data: gameState,
                });
            }
        });
        return result;
    }
    getPrefixedHistoryKeys() {
        return this.getKeys((key) => key.startsWith(this.storagePrefix));
    }
    getKeys(include) {
        const keys = [];
        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            if (key && include(key)) {
                keys.push(key);
            }
        }
        return keys;
    }
    loadGameStateData(prefixedKey) {
        if (!prefixedKey.startsWith(this.storagePrefix)) {
            return null;
        }
        return this.loadGameStateDataCore(prefixedKey);
    }
    loadGameStateDataCore(prefixedKey) {
        try {
            const gameStateString = this.storage.getItem(prefixedKey);
            if (!gameStateString) {
                return null;
            }
            const result = JSON.parse(gameStateString);
            return result.timestamp && result.data ? result : null;
        }
        catch (e) {
            console.warn('Error loading game state from storage for key:', prefixedKey, e);
            return null;
        }
    }
    ensureStorageLimit() {
        const prefixedKeys = this.getPrefixedHistoryKeys();
        if (prefixedKeys.length > this.maxNumberOfStoredGames) {
            console.info('Cropping game history');
            const keysByAge = [];
            for (const pk of prefixedKeys) {
                const gameState = this.loadGameStateData(pk);
                if (!gameState) {
                    console.debug(`Removing corrupt history entry ${pk}`);
                    this.storage.removeItem(pk);
                }
                else {
                    keysByAge.push({ key: pk, timestamp: gameState.timestamp });
                }
            }
            keysByAge.sort((a, b) => a.timestamp - b.timestamp);
            for (let i = 0; i < keysByAge.length - this.maxNumberOfStoredGames; i++) {
                const oldKey = keysByAge[i].key;
                console.debug(`Removing old history entry ${oldKey}`);
                this.storage.removeItem(oldKey);
            }
        }
    }
    migrate() {
        // migrates from old storage format (no prefixes, no version) to new format
        if (this.storage.getItem(this.versionKey)) {
            return;
        }
        const keysToMigrate = this.getKeys((key) => !key.startsWith(this.storagePrefix) &&
            !key.startsWith(this.generatePrefix));
        for (const key of keysToMigrate) {
            const item = this.storage.getItem(key);
            if (!item) {
                console.debug(`Removing unknown storage key ${key}`);
            }
            else {
                try {
                    const parsed = JSON.parse(item);
                    if (parsed.timestamp && parsed.data) {
                        console.debug(`Migrating game history entry ${key}`);
                        this.storage.setItem(this.storagePrefix + key, item);
                    }
                    else {
                        console.debug(`Removing unknown storage key ${key}`);
                    }
                }
                catch (e) {
                    console.debug(`Removing unknown storage key ${key}`);
                }
            }
            this.storage.removeItem(key);
        }
        this.storage.setItem(this.versionKey, '1');
        console.info('Migrated game history data');
    }
}
