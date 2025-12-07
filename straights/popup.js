// SPDX-FileCopyrightText: 2025 Moritz Ringler
//
// SPDX-License-Identifier: GPL-3.0-or-later
export function positionPopup(target, popup, windowLayout) {
    const targetPos = target.getBoundingClientRect();
    const windowHeight = windowLayout.height;
    const windowWidth = windowLayout.width;
    if (!windowHeight || !windowWidth) {
        return;
    }
    // Determine the vertical position
    let popupTop;
    if (targetPos.top + targetPos.height / 2 > windowHeight / 2) {
        popupTop =
            targetPos.top + windowLayout.scrollY - (popup.outerHeight() ?? 0);
    }
    else {
        popupTop = targetPos.top + windowLayout.scrollY + targetPos.height;
    }
    // Determine the horizontal position
    let popupLeft;
    if (targetPos.left + targetPos.width / 2 > windowWidth / 2) {
        popupLeft =
            targetPos.left + windowLayout.scrollX - (popup.outerWidth() ?? 0);
    }
    else {
        popupLeft = targetPos.left + windowLayout.scrollX + targetPos.width;
    }
    // Set the position of the dialog
    popup.css({
        position: 'absolute',
        top: popupTop,
        left: popupLeft,
    });
}
