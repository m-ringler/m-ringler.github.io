// SPDX-FileCopyrightText: 2025 Moritz Ringler
//
// SPDX-License-Identifier: GPL-3.0-or-later
const worker = new Worker('str8ts-api-worker.js');
export function generate(size, difficulty, gridLayout) {
    return run_in_worker({
        method: 'generate',
        size,
        difficulty,
        gridLayout,
    });
}
export function generateHint(gameAsJson) {
    return run_in_worker({
        method: 'hint',
        gameAsJson: JSON.stringify(gameAsJson),
    });
}
function run_in_worker(message) {
    return new Promise((resolve, reject) => {
        const handleMessage = (event) => {
            worker.removeEventListener('error', handleError);
            resolve(event.data);
        };
        const handleError = (error) => {
            worker.removeEventListener('message', handleMessage);
            reject(error);
        };
        worker.addEventListener('message', handleMessage, { once: true });
        worker.addEventListener('error', handleError, { once: true });
        worker.postMessage(message);
    });
}
