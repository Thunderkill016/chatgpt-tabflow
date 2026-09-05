export function computeGrid(count, width, height, density = 'auto') {
  const paneCount = Math.max(0, Math.floor(Number(count) || 0));
  const availableWidth = Math.max(320, Number(width) || 1280);
  const availableHeight = Math.max(240, Number(height) || 720);

  if (paneCount <= 1) {
    return { columns: 1, rows: 1, paneWidth: availableWidth, paneHeight: availableHeight };
  }

  const forcedColumns = Number.parseInt(density, 10);
  if (Number.isInteger(forcedColumns) && forcedColumns > 0) {
    const columns = Math.max(1, Math.min(paneCount, forcedColumns));
    const rows = Math.ceil(paneCount / columns);
    return {
      columns,
      rows,
      paneWidth: availableWidth / columns,
      paneHeight: availableHeight / rows
    };
  }

  const targetAspect = density === 'overview' ? 1.25 : 1.0;
  const minWidth = density === 'overview' ? 260 : 360;
  const minHeight = density === 'overview' ? 190 : 250;
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
    columns: best.columns,
    rows: best.rows,
    paneWidth: best.paneWidth,
    paneHeight: best.paneHeight
  };
}

export function densityWarning(grid) {
  if (!grid) return '';
  if (grid.paneWidth < 280 || grid.paneHeight < 190) {
    return 'Rất nhiều pane đang cùng hiển thị. Dùng Focus trên pane cần thao tác để giữ chữ dễ đọc.';
  }
  if (grid.paneWidth < 380 || grid.paneHeight < 250) {
    return 'Workspace đang ở mật độ cao; tất cả pane vẫn nằm trên cùng màn hình.';
  }
  return '';
}
