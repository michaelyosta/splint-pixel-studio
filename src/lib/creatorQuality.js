export function assessQuality(width, height, palette, cells) {
  const total = cells.length;
  const colorUsed = new Set(cells).size;
  const regionCounts = countSmallRegions(width, height, cells);
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

function countSmallRegions(width, height, cells) {
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
      visited.add(i);
      if (cells[i] !== color) continue;
      region.push(i);
      const x = i % width;
      const y = Math.floor(i / width);
      if (x > 0) stack.push(i - 1);
      if (x < width - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - width);
      if (y < height - 1) stack.push(i + width);
    }
    if (region.length <= 2) small += region.length;
  }
  return small;
}
