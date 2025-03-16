import { ResearchProgress } from './deep-research.js';

export class OutputManager {
  private progressLines: number = 4;
  private progressArea: string[] = [];
  private initialized: boolean = false;
  
  constructor() {
    // Initialize terminal
    process.stdout.write('\n'.repeat(this.progressLines));
    this.initialized = true;
  }
  
  log(...args: any[]) {
    // Move cursor up to progress area
    if (this.initialized) {
      process.stdout.write(`\x1B[${this.progressLines}A`);
      // Clear progress area
      process.stdout.write('\x1B[0J');
    }
    // Print log message
    console.log(...args);
    // Redraw progress area if initialized
    if (this.initialized) {
      this.drawProgress();
    }
  }
  
  updateProgress(progress: ResearchProgress) {
    const calculatePercentage = (current: number, total: number) => {
      const value = Math.min(Math.max(0, current), total);
      return Math.round((value / total) * 100);
    };

    const depthProgress = calculatePercentage(progress.currentDepth, progress.totalDepth);
    const breadthProgress = calculatePercentage(progress.currentBreadth, progress.totalBreadth);
    const queriesProgress = calculatePercentage(progress.completedQueries, progress.totalQueries);

    this.progressArea = [
      `Depth:    [${this.getProgressBar(depthProgress, 100)}] ${depthProgress}%`,
      `Breadth:  [${this.getProgressBar(breadthProgress, 100)}] ${breadthProgress}%`,
      `Queries:  [${this.getProgressBar(queriesProgress, 100)}] ${queriesProgress}%`,
      progress.currentQuery ? `Current:  ${progress.currentQuery}` : ''
    ];
    this.drawProgress();
  }
  
  private getProgressBar(value: number, total: number): string {
    const width = process.stdout.columns ? Math.min(30, process.stdout.columns - 20) : 30;
    const filled = Math.max(0, Math.min(width, Math.round((width * value) / total)));
    return '█'.repeat(filled) + ' '.repeat(Math.max(0, width - filled));
  }
  
  private drawProgress() {
    if (!this.initialized || this.progressArea.length === 0) return;
    
    // Move cursor to progress area
    const terminalHeight = process.stdout.rows || 24;
    process.stdout.write(`\x1B[${terminalHeight - this.progressLines};1H`);
    // Draw progress bars
    process.stdout.write(this.progressArea.join('\n'));
    // Move cursor back to content area
    process.stdout.write(`\x1B[${terminalHeight - this.progressLines - 1};1H`);
  }
}
