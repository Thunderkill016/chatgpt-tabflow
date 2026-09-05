export function computeGrid(count, width, height, density = 'auto') {
  const paneCount = Math.max(0, Math.floor(Number(count) || 0));
  const availableWidth = Math.max(320, Number(width) || 1280);
  const availableHeight = Math.max(240, Number(height) || 720);

  if (paneCount <= 1) {
    return {
      mode: 'single',
      columns: 1,
      rows: 1,
      paneWidth: availableWidth,
      paneHeight: availableHeight
    };
  }

  const forcedColumns = Number.parseInt(density, 10);
  if (Number.isInteger(forcedColumns) && forcedColumns > 0) {
    const columns = Math.max(1, Math.min(paneCount, forcedColumns));
    const rows = Math.ceil(paneCount / columns);
    return {
      mode: 'grid',
      columns,
      rows,
      paneWidth: availableWidth / columns,
      paneHeight: availableHeight / rows
    };
  }

  const spotlightEligible = paneCount === 3 && availableWidth >= 1080 && availableHeight >= 620;
  const wantsSpotlight = density === 'spotlight' || (density === 'auto' && spotlightEligible);
  if (wantsSpotlight && spotlightEligible) {
    const secondaryWidth = availableWidth * 0.36;
    return {
      mode: 'spotlight-3',
      columns: 2,
      rows: 2,
      paneWidth: secondaryWidth,
      paneHeight: availableHeight / 2,
      primaryWidth: availableWidth - secondaryWidth,
      primaryHeight: availableHeight
    };
  }

  if (paneCount === 2 && density !== 'overview') {
    return {
      mode: 'split',
      columns: 2,
      rows: 1,
      paneWidth: availableWidth / 2,
      paneHeight: availableHeight
    };
  }

  const targetAspect = density === 'overview' ? 1.28 : 1.0;
  const minWidth = density === 'overview' ? 250 : 340;
  const minHeight = density === 'overview' ? 180 : 235;
  let best = null;

  for (let columns = 1; columns <= paneCount; columns += 1) {
    const rows = Math.ceil(paneCount / columns);
    const paneWidth = availableWidth / columns;
    const paneHeight = availableHeight / rows;
    const aspect = paneWidth / Math.max(1, paneHeight);
    const wasteRatio = ((columns * rows) - paneCount) / paneCount;
    const aspectPenalty = Math.abs(Math.log(Math.max(0.05, aspect / targetAspect)));
    const widthPenalty = paneWidth < minWidth ? (minWidth - paneWidth) / minWidth : 0;
    const heightPenalty = paneHeight < minHeight ? (minHeight - paneHeight) / minHeight : 0;
    const score = aspectPenalty + wasteRatio * 0.65 + widthPenalty * 1.8 + heightPenalty * 1.5;

    if (!best || score < best.score) {
      best = { columns, rows, paneWidth, paneHeight, score };
    }
  }

  return {
    mode: 'grid',
    columns: best.columns,
    rows: best.rows,
    paneWidth: best.paneWidth,
    paneHeight: best.paneHeight
  };
}

export function densityWarning(grid) {
  if (!grid) return '';
  if (grid.mode === 'spotlight-3') return 'Spotlight: pane chính lớn, hai pane phụ vẫn luôn hiển thị.';
  if (grid.paneWidth < 280 || grid.paneHeight < 185) {
    return 'Mật độ rất cao · chọn pane chính rồi Focus để đọc/code thoải mái hơn.';
  }
  if (grid.paneWidth < 380 || grid.paneHeight < 245) {
    return 'Mật độ cao · tất cả pane vẫn nằm trên cùng workspace.';
  }
  return '';
}
