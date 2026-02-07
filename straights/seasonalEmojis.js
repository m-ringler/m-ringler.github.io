export const christmasEmojis = [
    '🔔',
    '🎁',
    '🕯️',
    '🎅',
    '👼',
    '🎶',
    '❄️',
    '☃️',
    '⛄',
    '🌟',
    '🎄',
    '🦌',
    '🌨️',
    '🎆',
    '🎇',
    '🧦',
    '🎀',
    '🧸',
    '🍀',
    '🛷',
];
export const valentineEmojis = ['🧡', '💛', '💚', '💙', '💜', '💖', '💘', '💕'];
export const easterEmojis = [
    '🐣',
    '🐰',
    '🌷',
    '🥚',
    '🥚',
    '🐤',
    '🐇',
    '🐑',
    '🧺',
];
export function getEasterDate(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}
export function getEmojis(now) {
    if (isChristmasTime(now)) {
        return { emojis: christmasEmojis, key: 'xmas' };
    }
    else if (isValentinesDay(now)) {
        return { emojis: valentineEmojis, key: 'valentine' };
    }
    else if (isEasterTime(now)) {
        return { emojis: easterEmojis, key: 'easter' };
    }
    return null;
}
function isValentinesDay(now) {
    const month = now.getMonth(); // 0 = Jan, 11 = Dec
    const day = now.getDate();
    return month === 1 && day === 14;
}
function isChristmasTime(now) {
    const month = now.getMonth(); // 0 = Jan, 11 = Dec
    const day = now.getDate();
    return (month === 11 && day >= 20) || (month === 0 && day <= 6);
}
function isEasterTime(now) {
    const easterDate = getEasterDate(now.getFullYear());
    const timeDiff = Math.abs(now.getTime() - easterDate.getTime());
    const daysDiff = timeDiff / (1000 * 60 * 60 * 24);
    return daysDiff <= 7;
}
