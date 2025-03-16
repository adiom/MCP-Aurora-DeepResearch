import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export class ResearchSession {
  private static instance: ResearchSession;
  public readonly uuid: string;

  private constructor() {
    this.uuid = uuidv4();
  }

  public static getInstance(): ResearchSession {
    if (!ResearchSession.instance) {
      ResearchSession.instance = new ResearchSession();
    }
    return ResearchSession.instance;
  }
}

const getLogFileName = () => {
  const session = ResearchSession.getInstance();
  const now = new Date();
  return `research-${session.uuid}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.log`;
};

export const logger = {
  log: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    const session = ResearchSession.getInstance();
    const logMessage = `[${timestamp}][${session.uuid}] ${message}${data ? '\nData: ' + JSON.stringify(data, null, 2) : ''}\n`;
    
    // Log to console
    console.log(logMessage);
    
    // Log to file
    const logFile = path.join(process.cwd(), getLogFileName());
    fs.appendFileSync(logFile, logMessage);
  },
  
  error: (message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    const session = ResearchSession.getInstance();
    const logMessage = `[${timestamp}][${session.uuid}] ERROR: ${message}${error ? '\nError: ' + JSON.stringify(error, null, 2) : ''}\n`;
    
    // Log to console
    console.error(logMessage);
    
    // Log to file
    const logFile = path.join(process.cwd(), getLogFileName());
    fs.appendFileSync(logFile, logMessage);
  }
}; 