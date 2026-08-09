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
    mode;
    value;
    game;
    wrong;
    hint;
    isShowingSolution;
    user;
    notes;
    constructor(row, col, mode, value, game) {
        this.row = row;
        this.col = col;
        this.mode = mode;
        this.value = value;
        this.game = game;
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
                if (this.game.autoFillSingleNote && this.notes.size === 1) {
                    // When auto-fill of a single note is enabled, a single note is
                    // treated as a solved field. If the user wants to switch to note
                    // mode by toggling the existing value off, we must remove the
                    // single note to avoid immediately re-converting back to a user value.
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
        return (this.game.activeFieldIndex !== null &&
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
    isSolvedCorrectly() {
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
        return this.isSolvedCorrectly() === 1;
    }
    checkWrong(checkNotes = false) {
        const correct = this.isSolvedCorrectly();
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
        this.wrong = this.isSolvedCorrectly() === -1;
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
        const field = new Field(this.row, this.col, this.mode, this.value, this.game);
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
    autoFillSingleNote;
    checkerboardDump = null;
    constructor(renderer, size = 0, autoFillSingleNote = true) {
        this.renderer = renderer;
        this.size = size;
        this.data = [];
        this.activeFieldIndex = null;
        this.isSolved = false;
        this.autoFillSingleNote = autoFillSingleNote;
        for (let r = 0; r < size; r++) {
            this.data.push([]);
            for (let c = 0; c < size; c++) {
                // initialize all fields as black
                this.data[r].push(new Field(r, c, FieldModes.BLACK, undefined, this));
            }
        }
        this.check_count = 0;
        this.hint_count = 0;
        this.created = Date.now();
    }
    getField(idx) {
        return this.get(idx.row, idx.col);
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
            userFields[i].reset(toFieldUserData(decoded[i], this.autoFillSingleNote));
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
            if (this.autoFillSingleNote && !field.user && field.notes.size == 1) {
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
        const move = (value, delta) => {
            return (value + delta + this.size) % this.size;
        };
        let newRow = move(row, rowDelta);
        let newCol = move(col, colDelta);
        let success = this.get(newRow, newCol).isEditable();
        if (!success && rowDelta != 0) {
            // If new field is not editable, try to find the next
            // editable field in the target column by moving further
            // in the direction of rowDelta.
            const one = Math.sign(rowDelta);
            for (let stepped = 0; stepped < this.size; stepped++) {
                newRow = move(newRow, one);
                if (this.get(newRow, newCol).isEditable()) {
                    success = true;
                    break;
                }
            }
        }
        if (!success && colDelta != 0) {
            // If new field is not editable, try to find the next
            // editable field in the target row by moving further
            // in the direction of colDelta.
            const one = Math.sign(colDelta);
            for (let stepped = 0; stepped < this.size; stepped++) {
                newCol = move(newCol, one);
                if (this.get(newRow, newCol).isEditable()) {
                    success = true;
                    break;
                }
            }
        }
        return success ? { row: newRow, col: newCol } : { row, col };
    }
    parseGameCode(base64urlEncodedGameCode, autoFillSingleNote = true) {
        return GameReader.createGame(base64urlEncodedGameCode, (n) => new GameBuilder(new Game(this.renderer, n, autoFillSingleNote)));
    }
    toJsonArray() {
        return this.data.map((row) => row.map((field) => field.toJsonArray()));
    }
}
function toFieldUserData(notes, autoFillSingleNote = true) {
    let user = undefined;
    // Single note is solved field only when the game option is active.
    if (autoFillSingleNote && notes.size == 1) {
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
        const field = new Field(row, col, mode, value, this.game);
        this.game.data[row][col] = field;
        field.render();
    }
    getGame() {
        return this.game;
    }
}
