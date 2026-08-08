export function assessQuality(width, height, palette, cells) {
  const total = cells.length;
  const colorUsed = new Set(cells).size;
  const regionCounts = countSmallRegionCells(width, height, cells);
  const smallRegionRatio = regionCounts / total;
  const colorEfficiency = colorUsed / palette.length;

  if (smallRegionRatio < 0.02 && colorEfficiency > 0.5) {
    return { level: 'good', label: 'Подходит для пиксельной раскраски', hint: null };
  }
  if (smallRegionRatio < 0.08) {
    return { level: 'fair', label: 'Некоторые детали упростятся', hint: 'Попробуйте увеличить размер сетки или количество цветов.' };
  }
  return { level: 'noisy', label: 'Слишком много мелких деталей', hint: 'Попробуйте кадрировать, увеличить сетку или выбрать больше цветов.' };
}

export function countSmallRegionCells(width, height, cells) {
  const visited = new Set();
  let small = 0;
  for (let index = 0; index < cells.length; index += 1) {
    if (visited.has(index)) continue;
    const color = cells[index];
    const region = [];
    const stack = [index];
    while (stack.length) {
      const i = stack.pop();
      if (visited.has(i)) continue;
      if (cells[i] !== color) continue;
      visited.add(i);
      region.push(i);
      const x = i % width;
      const y = Math.floor(i / width);
      if (x > 0 && cells[i - 1] === color) stack.push(i - 1);
      if (x < width - 1 && cells[i + 1] === color) stack.push(i + 1);
      if (y > 0 && cells[i - width] === color) stack.push(i - width);
      if (y < height - 1 && cells[i + width] === color) stack.push(i + width);
    }
    if (region.length <= 2) small += region.length;
  }
  return small;
}

export async function countSmallRegionCellsAsync(width, height, cells, yieldEvery = 96) {
  const visited = new Set();
  let small = 0;
  let counter = 0;
  for (let index = 0; index < cells.length; index += 1) {
    counter += 1;
    if (counter % yieldEvery === 0) {
      if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') await scheduler.yield();
      else await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (visited.has(index)) continue;
    const color = cells[index];
    const region = [];
    const stack = [index];
    while (stack.length) {
      const i = stack.pop();
      if (visited.has(i)) continue;
      if (cells[i] !== color) continue;
      visited.add(i);
      region.push(i);
      const x = i % width;
      const y = Math.floor(i / width);
      if (x > 0 && cells[i - 1] === color) stack.push(i - 1);
      if (x < width - 1 && cells[i + 1] === color) stack.push(i + 1);
      if (y > 0 && cells[i - width] === color) stack.push(i - width);
      if (y < height - 1 && cells[i + width] === color) stack.push(i + width);
    }
    if (region.length <= 2) small += region.length;
  }
  return small;
}

export async function assessQualityAsync(width, height, palette, cells, { yieldEvery = 96 } = {}) {
  const total = cells.length;
  const colorUsed = new Set(cells).size;
  const regionCounts = await countSmallRegionCellsAsync(width, height, cells, yieldEvery);
  const smallRegionRatio = regionCounts / total;
  const colorEfficiency = colorUsed / palette.length;

  if (smallRegionRatio < 0.02 && colorEfficiency > 0.5) {
    return { level: 'good', label: 'Подходит для пиксельной раскраски', hint: null };
  }
  if (smallRegionRatio < 0.08) {
    return { level: 'fair', label: 'Некоторые детали упростятся', hint: 'Попробуйте увеличить размер сетки или количество цветов.' };
  }
  return { level: 'noisy', label: 'Слишком много мелких деталей', hint: 'Попробуйте кадрировать, увеличить сетку или выбрать больше цветов.' };
}
