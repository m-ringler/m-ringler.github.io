// SPDX-FileCopyrightText: 2020 Luis Walter, 2025 Moritz Ringler
//
// SPDX-License-Identifier: GPL-3.0-or-later
import { BitmaskEncoder } from './encoder.js';
import * as EncoderModule from './encoder.js';
import * as GameReader from './gameReader.js';
export const FieldModes = GameReader.FieldModes;
const MIN_GRID_SIZE_V128 = 4;
const minCodeSizeV2 = 82;
const minCodeSizeV128 = (8 /* ENCODINGVERSION */ +
    5 /* size */ +
    2 * MIN_GRID_SIZE_V128 * MIN_GRID_SIZE_V128) /* black, known */ /
    6;
export const minCodeSize = Math.min(minCodeSizeV2, minCodeSizeV128);
export class Field {
    row;
    col;
    game;
    value;
    mode;
    wrong;
    hint;
    isShowingSolution;
    user;
    notes;
    constructor(row, col, game) {
        this.row = row;
        this.col = col;
        this.game = game;
        // fixed after initialization
        this.value = undefined;
        this.mode = undefined;
        // derived, only used when checking
        this.wrong = false;
        this.hint = undefined;
        this.isShowingSolution = false;
        // working data, edited by the user
        this.user = undefined;
        this.notes = new Set();
    }
    setUser(input) {
        if (this.isEditable()) {
            this.wrong = false;
            this.hint = undefined;
            if (this.user === input) {
                this.user = undefined;
                if (this.notes.size === 1) {
                    // When we only have a single note we automatically
                    // set the user value to that note. But here, we want
                    // to switch to note mode. Therefore, we need to remove
                    // the single note.
                    this.notes.clear();
                }
            }
            else {
                this.user = input;
            }
            this.render();
        }
    }
    isActive() {
        return (this.game.activeFieldIndex &&
            this.game.activeFieldIndex.col === this.col &&
            this.game.activeFieldIndex.row === this.row);
    }
    isEditable() {
        return this.mode === FieldModes.USER;
    }
    setNote(value) {
        if (this.isEditable()) {
            this.wrong = false;
            this.hint = undefined;
            this.user = undefined;
            if (!this.notes.delete(value)) {
                this.notes.add(value);
            }
            this.render();
        }
    }
    toggleNoOrAllNotes() {
        if (!this.isEditable || this.user) {
            return;
        }
        if (this.notes.size === 0) {
            for (let i = 1; i <= this.game.size; i++) {
                this.notes.add(i);
            }
        }
        else if (this.notes.size === this.game.size) {
            this.notes.clear();
        }
        this.render();
    }
    clear() {
        if (this.isEditable()) {
            if (this.user) {
                this.user = undefined;
            }
            else {
                this.notes.clear();
            }
            this.wrong = false;
            this.hint = undefined;
            this.render();
        }
    }
    #isSolvedCorrectly() {
        if (!this.isEditable()) {
            return 1;
        }
        if (!this.user) {
            return 0;
        }
        if (this.user === this.value) {
            return 1;
        }
        return -1;
    }
    isSolved() {
        return this.#isSolvedCorrectly() === 1;
    }
    checkWrong(checkNotes = false) {
        const correct = this.#isSolvedCorrectly();
        switch (correct) {
            case -1:
                this.wrong = true;
                this.render();
                break;
            case 0:
                if (checkNotes &&
                    this.notes.size != 0 &&
                    !this.notes.has(this.value)) {
                    this.wrong = true;
                    this.render();
                }
                break;
            default:
                break;
        }
    }
    showSolution() {
        this.isShowingSolution = true;
        this.wrong = this.#isSolvedCorrectly() === -1;
        this.render();
    }
    setHint(number) {
        this.hint = number;
        if (number && this.notes.size === 0) {
            for (let i = 1; i <= this.game.size; i++) {
                this.notes.add(i);
            }
        }
        this.render();
    }
    copy() {
        const field = new Field(this.row, this.col, this.game);
        field.value = this.value;
        field.mode = this.mode;
        field.wrong = this.wrong;
        field.isShowingSolution = this.isShowingSolution;
        field.copyFrom(this);
        return field;
    }
    copyFrom(field) {
        this.user = field.user;
        this.notes.clear();
        for (const note of field.notes) {
            this.notes.add(note);
        }
    }
    reset(template = null) {
        this.user = undefined;
        this.notes.clear();
        this.wrong = false;
        this.hint = undefined;
        this.isShowingSolution = false;
        if (template) {
            this.copyFrom(template);
        }
        this.render();
    }
    render() {
        this.game.renderer.renderField(this);
    }
    toJsonArray() {
        if (this.mode === FieldModes.BLACK) {
            return [0]; // black empty field
        }
        else if (this.mode === FieldModes.BLACKKNOWN) {
            return [-this.value]; // black known field
        }
        else if (this.mode === FieldModes.WHITEKNOWN) {
            return [this.value]; // white known field
        }
        else if (this.user) {
            return [this.user]; // white field with user guess
        }
        else {
            return Array.from(this.notes); // white field with notes
        }
    }
}
// class to store and modify the current game state
export class Game {
    renderer;
    size;
    data;
    isSolved;
    activeFieldIndex;
    check_count;
    hint_count;
    created;
    checkerboardDump = null;
    constructor(renderer, size = 0) {
        this.renderer = renderer;
        this.size = size;
        this.data = [];
        this.activeFieldIndex = null;
        this.isSolved = false;
        for (let r = 0; r < size; r++) {
            this.data.push([]);
            for (let c = 0; c < size; c++) {
                this.data[r].push(new Field(r, c, this));
            }
        }
        this.check_count = 0;
        this.hint_count = 0;
        this.created = Date.now();
    }
    get(row, col) {
        return this.data[row][col];
    }
    dumpState() {
        const state = this.dumpStateBase64();
        const historyData = {
            gameState: state,
            checkerboard: this.getCheckerboardDump(),
            size: this.size,
            created: this.created,
            percentSolved: this.getPercentSolved(),
        };
        const result = {
            check_count: this.check_count,
            hint_count: this.hint_count,
            data: historyData,
        };
        return result;
    }
    getPercentSolved() {
        let numUserFields = 0;
        let solved = 0;
        this.getUserFields().forEach((f) => {
            numUserFields++;
            if (f.isSolved()) {
                solved += 1;
            }
            else if (f.notes.size === 0) {
                // blank field: no progress
            }
            else {
                solved += 1 - (f.notes.size - 1) / (this.size - 1);
            }
        });
        const percentSolved = numUserFields === 0 ? 100 : Math.floor((solved / numUserFields) * 100);
        return percentSolved;
    }
    getCheckerboardDump() {
        if (this.checkerboardDump === null) {
            const cb = [];
            for (const row of this.data) {
                cb.push(row.map((f) => f.mode === FieldModes.BLACK || f.mode === FieldModes.BLACKKNOWN));
            }
            this.checkerboardDump = EncoderModule.encodeGridToBase64Url(cb);
        }
        return this.checkerboardDump;
    }
    async restoreStateAsync(dumpedState) {
        if (Object.hasOwn(dumpedState, 'check_count')) {
            // new format including check and hint count
            const ds = dumpedState;
            this.check_count = ds.check_count;
            this.hint_count = ds.hint_count;
            const data = ds.data;
            if (Object.hasOwn(data, 'gameState')) {
                // current format F2.2: data is HistoryData
                const historyData = data;
                await this.restoreStateBase64Async(historyData.gameState);
                this.created = historyData.created;
            }
            else {
                // previous format F2.1: data is FieldUserData[][]
                await this.restoreStateAsync(data);
            }
        }
        else {
            // first format F1 (just field data) also used in
            // recursive call for format F2.1
            const ds = dumpedState;
            ds.forEach((row, r) => {
                row.forEach((field, c) => {
                    const gameField = this.get(r, c);
                    gameField.copyFrom(field);
                    gameField.render();
                });
            });
        }
    }
    getEncoder() {
        return new BitmaskEncoder({
            compressionThreshold: 48,
            minCompressionRatio: 0.9,
            maxN: 12,
        });
    }
    getUserFields() {
        return Array.from(this.loopFields(), (x) => x.field).filter((x) => x.mode === FieldModes.USER);
    }
    dumpStateBase64() {
        const encoder = this.getEncoder();
        var data = this.getState();
        const encoded = encoder.encodeUncompressed(this.size, data);
        return encoded.base64Data;
    }
    getState() {
        return this.getUserFields().map((f) => (f.user ? [f.user] : f.notes));
    }
    async dumpStateBase64Async() {
        const encoder = this.getEncoder();
        var data = this.getState();
        const encoded = await encoder.encodeAsync(this.size, data);
        return encoded.base64Data;
    }
    async restoreStateBase64Async(base64Data) {
        const userFields = this.getUserFields();
        const count = userFields.length;
        const decoded = await this.getEncoder().decodeAsync({ base64Data, count }, this.size);
        for (let i = 0; i < count; i++) {
            userFields[i].reset(toFieldUserData(decoded[i]));
        }
    }
    *loopFields() {
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                const field = this.data[r][c];
                yield { field, row: r, col: c };
            }
        }
    }
    forEachField(iteratorFunction) {
        for (const { field, row, col } of this.loopFields()) {
            iteratorFunction(field, row, col);
        }
    }
    showSolution() {
        if (this.isSolved) {
            return;
        }
        this.isSolved = true;
        this.unselectActiveField();
        this.forEachField((field) => {
            field.showSolution();
        });
    }
    checkWrong(checkNotes = false) {
        let result = false;
        this.forEachField((field) => {
            field.checkWrong(checkNotes);
            if (field.wrong) {
                result = true;
            }
        });
        return result;
    }
    checkSolved() {
        if (this.isSolved) {
            return;
        }
        let finished = true;
        this.forEachField((field) => {
            if (!field.user && field.notes.size == 1) {
                field.user = field.notes.values().next().value;
                field.notes.clear();
                field.render();
            }
            if (!field.isSolved()) {
                finished = false;
            }
        });
        this.isSolved = finished;
        if (this.isSolved) {
            this.unselectActiveField();
        }
    }
    checkForHint() {
        this.checkSolved();
        function getResult(solved, wrong) {
            const result = { isSolved: solved, isWrong: wrong };
            return result;
        }
        if (this.isSolved) {
            return getResult(true, false);
        }
        this.hint_count++;
        if (this.checkWrong(false) || this.checkWrong(true)) {
            return getResult(false, true);
        }
        return getResult(false, false);
    }
    check() {
        this.checkSolved();
        if (this.isSolved) {
            return;
        }
        this.check_count++;
        this.checkWrong();
    }
    restart() {
        this.isSolved = false;
        this.forEachField((field) => field.reset());
    }
    getActiveField() {
        return this.activeFieldIndex
            ? this.get(this.activeFieldIndex.row, this.activeFieldIndex.col)
            : null;
    }
    unselectActiveField() {
        const activeField = this.getActiveField();
        if (activeField) {
            this.activeFieldIndex = null;
            activeField.render();
        }
    }
    setActiveField(row, col) {
        if (!this.isSolved && this.get(row, col).isEditable()) {
            // Reset previously selected field
            this.unselectActiveField();
            // Change background of just selected field
            this.activeFieldIndex = { row, col };
            this.getActiveField().render();
        }
    }
    moveSelection(dx, dy) {
        if (!this.activeFieldIndex) {
            return;
        }
        const { row, col } = this.activeFieldIndex;
        var newCell = this.findNextEditableField(row, col, dy, dx);
        this.setActiveField(newCell.row, newCell.col);
    }
    findNextEditableField(row, col, rowDelta, colDelta) {
        let newRow = row;
        let newCol = col;
        do {
            newRow = (newRow + rowDelta + this.size) % this.size;
            newCol = (newCol + colDelta + this.size) % this.size;
        } while (!this.get(newRow, newCol).isEditable() &&
            (newRow !== row || newCol != col));
        return { row: newRow, col: newCol };
    }
    parseGameCode(base64urlEncodedGameCode) {
        return GameReader.createGame(base64urlEncodedGameCode, (n) => new GameBuilder(new Game(this.renderer, n)));
    }
    toJsonArray() {
        return this.data.map((row) => row.map((field) => field.toJsonArray()));
    }
}
function toFieldUserData(notes) {
    let user = undefined;
    // Single note is solved field.
    if (notes.size == 1) {
        for (let v of notes) {
            user = v;
        }
    }
    const userData = { user, notes };
    return userData;
}
class GameBuilder {
    game;
    constructor(game) {
        this.game = game;
    }
    setField(row, col, mode, value) {
        const field = new Field(row, col, this.game);
        field.mode = mode;
        field.value = value;
        this.game.data[row][col] = field;
        field.render();
    }
    getGame() {
        return this.game;
    }
}
