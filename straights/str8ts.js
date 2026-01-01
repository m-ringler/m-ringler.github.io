// SPDX-FileCopyrightText: 2020 Luis Walter, 2025-2026 Moritz Ringler
//
// SPDX-License-Identifier: GPL-3.0-or-later
// module imports
import * as Str8ts from './game.js';
import * as Renderer from './gameRenderer.js';
import * as api from './str8ts-api.js';
import * as Popup from './popup.js';
// module member imports
import { UndoStack } from './undoStack.js';
import { NumberInput } from './numberInput.js';
import { GameHistory } from './gameHistory.js';
import * as HistoryRendererModule from './historyRenderer.js';
import * as CheckerboardModule from './checkerboard.js';
import { decodeGridFromBase64Url } from './encoder.js';
const GridLayoutOptions = [
    { id: 'PointSymmetric', caption: 'Point Symmetric', apiValue: 7 },
    { id: 'DiagonallySymmetric', caption: 'Diagonally Symmetric', apiValue: 3 },
    {
        id: 'HorizontallySymmetric',
        caption: 'Horizontally Symmetric',
        apiValue: 4,
    },
    { id: 'VerticallySymmetric', caption: 'Vertically Symmetric', apiValue: 5 },
    {
        id: 'HorizontallyAndVerticallySymmetric',
        caption: 'Horiz. & Vert. Symmetric',
        apiValue: 6,
    },
    { id: 'Random', caption: 'Random', apiValue: 0 },
    { id: 'Uniform', caption: 'Uniform', apiValue: 1 },
];
const dialogs = {
    NEW_GAME: 1,
    GENERATING_NEW_GAME: 3,
    SOLUTION: 4,
    RESTART: 5,
    ABOUT: 6,
    HINT: 7,
    HISTORY: 8,
};
const MIN_GRID_SIZE = 4;
const MAX_GRID_SIZE = 12;
const DEFAULT_GRID_SIZE = 9;
const DEFAULT_DIFFICULTY = 3;
// We wrap the UI behavior into a single controller class to avoid leaking many globals
export class UIController {
    // state
    starttime;
    timer;
    isInNoteMode = false;
    game;
    gameCode;
    gameUrl;
    generateDifficulty = DEFAULT_DIFFICULTY;
    currentGridSize = 12;
    generateGridSize = DEFAULT_GRID_SIZE;
    generateLayout = 'PointSymmetric';
    undoStack;
    hintField = null;
    buttonColors;
    numberInput;
    gameHistory;
    historyRenderer;
    // injected dependencies
    $;
    win;
    renderer;
    setSelectedLayoutOption;
    constructor($, win) {
        this.$ = $;
        this.win = win;
        this.undoStack = new UndoStack(this.renderUndoButton.bind(this));
        const darkMode = win.matchMedia('(prefers-color-scheme: dark)').matches;
        this.buttonColors = getButtonColors(darkMode);
        this.renderer = new Renderer.JQueryFieldRenderer(this.$, darkMode);
        this.game = new Str8ts.Game(this.renderer);
        this.gameHistory = new GameHistory(localStorage);
        this.numberInput = new NumberInput((num) => this.handleNumberInput(num));
        this.historyRenderer = new HistoryRendererModule.HistoryRenderer(this.$, this.$('#history-div'), async () => await this.getHistoryRendererDataAsync());
    }
    async getHistoryRendererDataAsync() {
        const historyData = this.gameHistory.getAllSavedGames();
        const cbOptions = this.getHistoryCheckerboardOptions();
        const result = historyData.map((entry) => this.getHistoryRendererDataItem(entry, cbOptions));
        return result;
    }
    getHistoryCheckerboardOptions() {
        const borderColor = this.$(':root').css('--color-cell-border');
        const cbOptions = {
            gridSizePixels: 100.0,
            borderColor: borderColor,
            trueColor: this.renderer.colors.BG_BLACK,
            falseColor: this.renderer.colors.BG_WHITEKNOWN,
        };
        return cbOptions;
    }
    getHistoryRendererDataItem(entry, cbOptions) {
        const modified = new Date(entry.data.timestamp);
        const historyData = (entry.data.data?.data ??
            {});
        const code = entry.key;
        const created = historyData.created
            ? new Date(historyData.created)
            : undefined;
        const cb = historyData.size && historyData.checkerboard
            ? { checkerboard: historyData.checkerboard, size: historyData.size }
            : { checkerboard: 'HBEQQCBgQCAACAA=', size: 9 };
        return {
            id: entry.key,
            modified: modified,
            created: created,
            size: historyData.size,
            percentSolved: historyData.percentSolved,
            renderGrid: (canvas) => {
                const cb1 = decodeGridFromBase64Url(cb.checkerboard, cb.size);
                CheckerboardModule.renderCheckerboard(canvas, cb1, cbOptions);
            },
            startGameAsync: async () => {
                await this.startGameCodeAsync(code);
            },
        };
    }
    // Button Functions
    async restartAsync() {
        await this.showDialogAsync(false);
        this.game.restart();
        this.undoStack.clear();
    }
    toggleNoteMode() {
        this.isInNoteMode = !this.isInNoteMode;
        const color = this.isInNoteMode
            ? this.buttonColors.BUTTONDOWN
            : this.buttonColors.BUTTONUP;
        this.$('#toggle-notes-mode-button').css('background-color', color);
    }
    renderCounters() {
        this.$('#check-counter').text(this.game.check_count);
        this.$('#hint-counter').text(this.game.hint_count);
    }
    check() {
        this.game.check();
        this.renderCounters();
        this.saveState();
    }
    async generateAndDisplayHintAsync() {
        await this.closeHintAsync();
        const checkResult = this.game.checkForHint();
        this.renderCounters();
        if (!(checkResult.isSolved || checkResult.isWrong)) {
            await this.generateAndDisplayHintCoreAsync();
        }
        this.saveState();
    }
    async generateAndDisplayHintCoreAsync() {
        let resp;
        try {
            resp = await api.generateHint(this.game.toJsonArray());
        }
        catch (ex) {
            console.error('Hint generation failed or unsupported:', ex);
            return;
        }
        if (resp && resp.status === 0 && resp.message) {
            const hintData = JSON.parse(resp.message);
            this.hintField = this.game.get(hintData.y, hintData.x);
            this.hintField.setHint(hintData.number);
            // hintData.rule is either ColumnNameInPascalCase or BlockNameInPascalCase.
            const ruleWords = hintData.rule.split(/(?=[A-Z])/);
            const ruleType = ruleWords[0];
            const ruleName = ruleWords.slice(1).join(' ');
            const ruleTarget = ruleType == 'Block'
                ? `${hintData.direction} block`
                : hintData.direction == 'horizontal'
                    ? 'row'
                    : 'column';
            this.$('#hint-text').html(`Hint: ${hintData.number} can be removed by applying the <a href="https://github.com/m-ringler/straights/wiki/Rules-of-Str8ts#${hintData.rule}" target="rules">${ruleName} rule</a> to the ${ruleTarget}.`);
            const popup = this.$('#hint-dialog');
            popup.css(Popup.getPopupPosition(popup, this.renderer.getElement(this.hintField)[0].getBoundingClientRect(), this.win.document.body.getBoundingClientRect()));
            await this.showDialogAsync(dialogs.HINT);
        }
        else if (resp && resp.message) {
            console.error('Failed to generate a hint:', resp.message);
        }
    }
    async closeHintAsync() {
        if (this.hintField) {
            this.hintField.setHint(undefined);
            this.hintField = null;
            await this.showDialogAsync(false);
        }
    }
    async showSolutionAsync() {
        await this.showDialogAsync(false);
        clearInterval(this.timer);
        this.game.showSolution();
        this.undoStack.clear();
    }
    undo() {
        if (this.undoStack.length > 0 && !this.game.isSolved) {
            const field = this.undoStack.pop();
            const gameField = this.game.get(field.row, field.col);
            gameField.copyFrom(field);
            gameField.wrong = false;
            this.game.selectCell(field.row, field.col);
            gameField.render();
        }
    }
    selectCell(row, col) {
        this.game.selectCell(row, col);
    }
    toggleNoOrAllNotes(row, col) {
        this.selectCell(row, col);
        this.pushActiveFieldToUndoStack();
        this.game.get(row, col).toggleNoOrAllNotes();
    }
    renderUndoButton(length) {
        const undoButton = this.$('#undo-button');
        if (length == 0 || this.game.isSolved) {
            undoButton.prop('disabled', true);
            undoButton.attr('disabled', 'disabled'); // Ensure attribute is present for CSS to update
        }
        else {
            undoButton.prop('disabled', false);
            undoButton.removeAttr('disabled'); // Ensure attribute is removed for CSS to update
        }
    }
    // General Functions
    changeGridSize(newGridSize) {
        if (newGridSize == this.currentGridSize) {
            return;
        }
        this.currentGridSize = Math.min(newGridSize, MAX_GRID_SIZE);
        this.currentGridSize = Math.max(this.currentGridSize, MIN_GRID_SIZE);
        this.showHideButtonsAndCells();
    }
    showHideButtonsAndCells() {
        for (let i = 1; i <= this.currentGridSize; i++) {
            this.$(`td[data-button="bn${i}"]`).show();
        }
        for (let i = this.currentGridSize + 1; i <= MAX_GRID_SIZE; i++) {
            this.$(`td[data-button="bn${i}"]`).hide();
        }
        for (let r = 0; r < this.currentGridSize; r++) {
            this.$('#r' + r).show();
            for (let c = 0; c < this.currentGridSize; c++) {
                this.$(`#ce${r}_${c}`).show();
            }
            for (let c = this.currentGridSize; c < MAX_GRID_SIZE; c++) {
                this.$(`#ce${r}_${c}`).hide();
            }
        }
        for (let r = this.currentGridSize; r < MAX_GRID_SIZE; r++) {
            this.$('#r' + r).hide();
        }
    }
    createGrid() {
        for (let r = 0; r < MAX_GRID_SIZE; r++) {
            let row = `<tr class="row" id="r${r}" data-row="${r}">`;
            for (let c = 0; c < MAX_GRID_SIZE; c++) {
                row += `<td class="cell" id="ce${r}_${c}" data-row="${r}" data-col="${c}"></td>`;
            }
            row += '</tr>';
            this.$('.container').append(row);
        }
    }
    restartTimer() {
        this.starttime = new Date().getTime();
        this.timer = setInterval(() => {
            const diff = new Date().getTime() - this.starttime;
            const minutes = Math.floor(diff / 60000);
            const seconds = Math.floor(diff / 1000 - minutes * 60);
            this.$('#time-counter').text((minutes < 10 ? '0' : '') +
                minutes +
                ':' +
                (seconds < 10 ? '0' : '') +
                seconds);
        }, 1000);
    }
    getURLParameter(name) {
        if (!this.win.location.search)
            return null;
        const urlParams = new URLSearchParams(this.win.location.search);
        return urlParams.get(name);
    }
    removeURLParameter(paramKey) {
        // Get the current URL and its search part
        const url = new URL(this.win.location.href);
        const searchParams = new URLSearchParams(url.search);
        // Remove the specified parameter
        searchParams.delete(paramKey);
        // Update the URL without reloading the page
        url.search = searchParams.toString();
        this.win.history.replaceState({}, '', url);
    }
    async generateNewGameAsync() {
        await this.showDialogAsync(dialogs.GENERATING_NEW_GAME);
        clearInterval(this.timer);
        this.$('#confirm-new-game-button').prop('disabled', true);
        try {
            let layoutOption = GridLayoutOptions.find((o) => o.id === this.generateLayout);
            if (layoutOption === undefined) {
                console.error('Invalid layout option selected:', this.generateLayout);
                layoutOption = GridLayoutOptions[0];
            }
            const data = await api.generate(this.generateGridSize, this.generateDifficulty, layoutOption.apiValue);
            if (data.status === 0 && data.message.length > Str8ts.minCodeSize) {
                const code = data.message;
                await this.startGameCodeAsync(code);
                return;
            }
            else {
                console.error('Error generating game:', data.message);
            }
        }
        catch (error) {
            console.error('Error fetching game:', error);
        }
        await this.showDialogAsync(false);
        this.$('#confirm-new-game-button').prop('disabled', false);
    }
    async startGameCodeAsync(code) {
        console.log('Game:', code);
        this.gameUrl = this.win.location.href.split('?')[0] + '?code=' + code;
        this.gameCode = code;
        await this.startGameAsync(true);
    }
    loadSettings() {
        var values = loadNewGameSettings(this.$, (key) => localStorage.getItem(key));
        this.generateGridSize = values.generateGridSize;
        this.generateDifficulty = values.generateDifficulty;
        this.generateLayout = values.generateLayout;
    }
    changeDifficulty() {
        this.generateDifficulty = Number(this.$('#difficulty-slider').val());
        this.$('#difficulty-text').text(this.generateDifficulty);
        localStorage.setItem('generate.difficulty', String(this.generateDifficulty));
    }
    changeGenerateSize() {
        this.generateGridSize = Number(this.$('#grid-size-slider').val());
        this.$('#grid-size-text').text(this.generateGridSize);
        localStorage.setItem('generate.gridSize', String(this.generateGridSize));
    }
    changeLayoutOption(selectedOption) {
        this.generateLayout = selectedOption ? selectedOption : 'PointSymmetric';
        localStorage.setItem('generate.layout', this.generateLayout);
    }
    async startGameAsync(shouldSetLocationHref) {
        let hasGame = false;
        if (this.gameCode && this.gameCode.length > Str8ts.minCodeSize) {
            this.undoStack.clear();
            this.$('.container').removeClass('finished');
            await this.showDialogAsync(false);
            const parsedGame = this.game.parseGame(this.gameCode);
            if (parsedGame) {
                this.game = parsedGame;
                hasGame = true;
                this.changeGridSize(this.game.size);
                await this.restoreGameStateAsync();
                this.restartTimer();
                this.renderCounters();
                if (shouldSetLocationHref && this.gameUrl != this.win.location.href) {
                    this.SetLocationHref(new URL(this.gameUrl));
                }
                this.saveState();
            }
        }
        if (!hasGame) {
            await this.generateNewGameAsync();
        }
    }
    async restoreGameStateAsync() {
        const stateLoadedFromUrl = await this.tryLoadStateFromUrlParameterAsync();
        if (!stateLoadedFromUrl) {
            await this.gameHistory.restoreGameStateAsync(this.gameCode, this.game);
        }
    }
    async tryLoadStateFromUrlParameterAsync() {
        const stateUrlParameter = this.getURLParameter('state');
        if (!stateUrlParameter) {
            return false;
        }
        try {
            this.removeURLParameter('state');
            await this.game.restoreStateBase64Async(stateUrlParameter);
            this.saveState();
            return true;
        }
        catch (ex) {
            console.error(ex);
            return false;
        }
    }
    async showNewGameDialogWithCancelButtonAsync() {
        await this.showDialogAsync(dialogs.NEW_GAME);
        this.$('#cancel-new-game-button').show();
    }
    async showDialogAsync(dialog) {
        this.$('#new-game-dialog').hide();
        this.$('#generating-new-game-dialog').hide();
        this.$('#solution-dialog').hide();
        this.$('#restart-dialog').hide();
        this.$('#about-dialog').hide();
        this.$('#hint-dialog').hide();
        this.$('#history-dialog').hide();
        if (dialog != dialogs.HINT) {
            await this.closeHintAsync();
        }
        if (dialog) {
            this.$('.dialog-outer-container').show();
            switch (dialog) {
                case dialogs.GENERATING_NEW_GAME:
                    this.$('#generating-new-game-dialog').show();
                    break;
                case dialogs.NEW_GAME:
                    this.$('#new-game-dialog').show();
                    // Force a re-render of the carousel to fix display issues
                    this.$('.carousel').slick('setPosition');
                    this.setSelectedLayoutOption(this.generateLayout);
                    break;
                case dialogs.SOLUTION:
                    if (!this.game.isSolved) {
                        this.$('#solution-dialog').show();
                    }
                    else {
                        this.$('.dialog-outer-container').hide();
                    }
                    break;
                case dialogs.RESTART:
                    if (!this.game.isSolved) {
                        this.$('#restart-dialog').show();
                    }
                    else {
                        this.$('.dialog-outer-container').hide();
                    }
                    break;
                case dialogs.ABOUT:
                    const link = await this._getCurrentLinkAsync();
                    this.$('#current-game-link').attr('href', link);
                    this.$('#about-dialog').show();
                    break;
                case dialogs.HINT:
                    this.$('#hint-dialog').show();
                    break;
                case dialogs.HISTORY:
                    await this.updateHistoryDivAsync();
                    this.$('#history-dialog').show();
                    break;
            }
        }
        else {
            this.$('.dialog-outer-container').hide();
        }
    }
    async updateHistoryDivAsync() {
        await this.historyRenderer.renderHistoryAsync(this.gameCode);
    }
    SetLocationHref(url) {
        this.win.history.pushState({}, '', url);
    }
    onKeyDown(e) {
        if (this.game.isSolved)
            return;
        let handled = false;
        const key = e.key;
        if (this.handleCursorKey(e)) {
            handled = true;
        }
        else if (key >= '0' && key <= '9') {
            handled = this.handleDigitKey(Number(key));
        }
        else if (key == 'n') {
            this.toggleNoteMode();
            handled = true;
        }
        else if (key == 'h' && e.altKey) {
            this.showDialogAsync(dialogs.HISTORY);
            handled = true;
        }
        else if (key == 'z' && e.ctrlKey) {
            this.undo();
            handled = true;
        }
        else if (key === 'Backspace' || key === 'Delete') {
            this.handleDelete();
            handled = true;
        }
        if (handled) {
            e.preventDefault();
        }
    }
    handleCursorKey(e) {
        switch (e.which) {
            case 37: // left
                this.game.moveSelection(-1, 0);
                break;
            case 38: // up
                this.game.moveSelection(0, -1);
                break;
            case 39: // right
                this.game.moveSelection(1, 0);
                break;
            case 40: // down
                this.game.moveSelection(0, 1);
                break;
            default:
                return false;
        }
        return true;
    }
    handleDigitKey(digit) {
        const handled = digit <= this.currentGridSize;
        if (handled) {
            this.numberInput.handleDigit(digit, this.currentGridSize);
        }
        return handled;
    }
    handleNumberInput(num) {
        if (num < 1 || num > this.currentGridSize) {
            return;
        }
        const activeField = this.game.getActiveField();
        if (!activeField || !activeField.isEditable()) {
            return;
        }
        this.pushToUndoStack(activeField);
        if (this.isInNoteMode) {
            activeField.setNote(num);
        }
        else {
            activeField.setUser(num);
            this.game.checkSolved();
            if (this.game.isSolved) {
                this.undoStack.clear();
                this.$('.container').addClass('finished');
                this._onResizeAsync();
                clearInterval(this.timer);
            }
        }
        this.saveState();
    }
    pushActiveFieldToUndoStack() {
        const activeField = this.game.getActiveField();
        if (!activeField || !activeField.isEditable()) {
            return;
        }
        this.pushToUndoStack(activeField);
    }
    pushToUndoStack(activeField) {
        this.undoStack.push(activeField.copy());
    }
    saveState() {
        this.gameHistory.saveGameState(this.gameCode, this.game);
    }
    handleDelete() {
        const field = this.game.getActiveField();
        if (!field || !field.isEditable()) {
            return;
        }
        this.undoStack.push(field.copy());
        field.clear();
    }
    async _getCurrentLinkAsync() {
        let link = this.win.location.href;
        if (this.game) {
            const stateBase64 = await this.game.dumpStateBase64Async();
            link += `&state=${stateBase64}`;
        }
        return link;
    }
    async copyCurrentLinkAsync() {
        try {
            const link = await this._getCurrentLinkAsync();
            await this.win.navigator.clipboard.writeText(link);
            const copyBtn = this.$('#copy-link-button');
            copyBtn.text('Link copied!');
            setTimeout(() => copyBtn.text('🔗'), 1000);
        }
        catch (err) {
            console.error('Failed to copy:', err);
        }
    }
    async handleGameLoadAsync() {
        const code = this.getURLParameter('code');
        const currentKey = this.win.location.href;
        if (code && code.length > Str8ts.minCodeSize) {
            this.gameUrl = currentKey;
            this.gameCode = code;
            await this.startGameAsync(false);
        }
        else {
            let latestKey = this.gameHistory.getLatestGameKey();
            if (latestKey) {
                await this.startGameCodeAsync(latestKey);
            }
            else {
                await this.generateNewGameAsync();
            }
        }
    }
    async _onResizeAsync() {
        await this.closeHintAsync();
        if (this.win.innerWidth / 2 - 45 <
            (this.$('.controls').position()?.left ?? 0)) {
            // Large screen
            this.$('#buttons-small').hide();
            this.$('#buttons-large').show();
            this.$('.cell').css({
                'font-size': '22pt',
                width: '41px',
                height: '41px',
            });
            this.$('.mini').css('font-size', '9pt');
            this.$('#hint-dialog').css('width', '235px');
        }
        else {
            // Small screen
            const cellwidth = Math.min(Math.floor(this.win.innerWidth / this.currentGridSize - 2), 41);
            this.$('#buttons-small').show();
            this.$('#buttons-large').hide();
            this.$('.container').css({ margin: '5px 2px' });
            this.$('.controls').css({ margin: '0px 2px' });
            this.$('.cell').css({
                'font-size': '17pt',
                width: `${cellwidth}px`,
                height: `${cellwidth}px`,
            });
            this.$('.mini').css('font-size', '8pt');
            this.$('#hint-dialog').css('width', '150px');
        }
    }
    // single public startup entry point for DOM initialisation
    async startAsync() {
        // initial UI setup
        this.createGrid();
        await this._onResizeAsync();
        this.renderLayoutCarousel();
        this.loadSettings();
        await this.handleGameLoadAsync();
        // event handlers for UI elements
        const gridCells = this.$('td[id^="ce"]');
        gridCells.on('click', (evt) => {
            const { row, col } = this.getRowAndColumnOfTargetCell(evt);
            this.selectCell(row, col);
        });
        gridCells.on('dblclick', (evt) => {
            const { row, col } = this.getRowAndColumnOfTargetCell(evt);
            this.toggleNoOrAllNotes(row, col);
        });
        const numberButtons = this.$('td[data-button^="bn"]');
        numberButtons.on('click', (evt) => {
            const el = evt.currentTarget;
            const num = Number(this.$(el).text());
            this.handleNumberInput(num);
        });
        // wire page-level events here so they can call private methods
        this.win.addEventListener('popstate', async () => {
            await this.handleGameLoadAsync();
        });
        this.$(document).on('keydown', (e) => {
            this.onKeyDown(e);
        });
        this.$(this.win).on('resize', async () => {
            await this._onResizeAsync();
        });
        // Controls wired from index.html
        this.$('#undo-button').on('click', () => this.undo());
        this.$('#toggle-notes-mode-button').on('click', () => this.toggleNoteMode());
        this.$('#check-button').on('click', () => this.check());
        this.$('#show-hint-button').on('click', async () => await this.generateAndDisplayHintAsync());
        this.$('#show-solution-button').on('click', async () => await this.showDialogAsync(dialogs.SOLUTION));
        this.$('#show-new-game-dialog-button').on('click', async () => await this.showNewGameDialogWithCancelButtonAsync());
        this.$('#show-restart-dialog-button').on('click', async () => await this.showDialogAsync(dialogs.RESTART));
        this.$('#show-about-dialog-button').on('click', async () => await this.showDialogAsync(dialogs.ABOUT));
        this.$('#show-history-dialog-button').on('click', async () => await this.showDialogAsync(dialogs.HISTORY));
        this.$('#grid-size-slider').on('input', () => this.changeGenerateSize());
        this.$('#difficulty-slider').on('input', () => this.changeDifficulty());
        this.$('#confirm-new-game-button').on('click', async () => await this.generateNewGameAsync());
        this.$('#cancel-new-game-button').on('click', async () => await this.showDialogAsync(false));
        this.$('#confirm-show-solution-button').on('click', async () => await this.showSolutionAsync());
        this.$('#confirm-restart-button').on('click', async () => await this.restartAsync());
        // Copy link and force-update actions
        this.$('#copy-link-button').on('click', async () => await this.copyCurrentLinkAsync());
        // The force-update action proper is registered in a script block in index.html
        this.$('#force-update').on('click', async () => await this.showDialogAsync(false));
        // Hint dialog close handlers (close the hint on click)
        this.$('#hint-dialog').on('click', async () => await this.closeHintAsync());
        this.$('#hint-close').on('click', async (e) => {
            e.stopPropagation();
            await this.closeHintAsync();
        });
        // generic close buttons for dialogs (hide overlay)
        this.$('.close-button')
            .not('#hint-close') // special handler above
            .on('click', async () => await this.showDialogAsync(false));
    }
    getRowAndColumnOfTargetCell(evt) {
        const selection = this.$(evt.currentTarget);
        const row = Number(selection.attr('data-row'));
        const col = Number(selection.attr('data-col'));
        return { row, col };
    }
    renderLayoutCarousel() {
        const $carousel = this.$('.carousel');
        $carousel.empty(); // Clear any existing content
        GridLayoutOptions.forEach((option) => {
            $carousel.append(`
      <div class="carousel-slide" data-id="${option.id}">
        <img src="layout-img/g_${option.id}.png" alt="${option.caption}" loading="lazy">
        <div class="caption">${option.caption}</div>
      </div>
    `);
        });
        $carousel.slick({
            dots: true,
            infinite: false,
            speed: 300,
            slidesToShow: 1,
            slidesToScroll: 1,
            arrows: true,
        });
        $carousel.on('afterChange', (event, slick, currentSlide) => {
            const currentOption = GridLayoutOptions[currentSlide];
            this.changeLayoutOption(currentOption.id);
        });
        this.setSelectedLayoutOption = (selectedOption) => {
            const index = GridLayoutOptions.findIndex((option) => option.id === selectedOption);
            if (index !== -1) {
                $carousel.slick('slickGoTo', index);
            }
        };
    }
}
function getButtonColors(darkMode) {
    const buttonColorsLight = {
        BUTTONDOWN: '#335',
        BUTTONUP: '#b1cffc',
    };
    const buttonColorsDark = {
        BUTTONDOWN: '#e7d9cdff' /* color-button-active */,
        BUTTONUP: '#555' /* color-button-background */,
    };
    return darkMode ? buttonColorsDark : buttonColorsLight;
}
function loadNewGameSettings($$, getStoredValue) {
    function loadSetting(sliderId, storageKey, defaultValue) {
        const slider = $$(`#${sliderId}`);
        const storedValue = getStoredValue(storageKey);
        let validatedValue = defaultValue;
        if (storedValue !== null) {
            const value = Number(storedValue);
            const min = Number(slider.attr('min'));
            const max = Number(slider.attr('max'));
            if (value >= min && value <= max) {
                validatedValue = value;
            }
        }
        slider.val(validatedValue);
        $$(`#${sliderId.replace('-slider', '-text')}`).text(validatedValue);
        return validatedValue;
    }
    try {
        const layout = getStoredValue('generate.layout') || 'PointSymmetric';
        return {
            generateGridSize: loadSetting('grid-size-slider', 'generate.gridSize', DEFAULT_GRID_SIZE),
            generateDifficulty: loadSetting('difficulty-slider', 'generate.difficulty', DEFAULT_DIFFICULTY),
            generateLayout: layout,
        };
    }
    catch (error) {
        console.warn('Failed to load settings:', error, 'Using defaults.');
        return {
            generateGridSize: DEFAULT_GRID_SIZE,
            generateDifficulty: DEFAULT_DIFFICULTY,
            generateLayout: 'PointSymmetric',
        };
    }
}
