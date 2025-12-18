import React, { useState, useEffect, useRef } from 'react';
import { render, useFocusManager } from 'ink';
import { Text, Box } from 'ink';

let setLogItems;
// Define types for our log entries
interface LogEntry {
    id: number;
    text: string;
    timestamp: Date;
}

// Define types for status bar data
interface StatusBarData {
    promptTokens: number;
    completionTokens?: number;
    promptCachedTokens: number;
    totalTokens: number;
    tokensPerSecond: number;
    promptProcessingPerSecond: number;
    currentlyRunningTool: string | null;
    model: string | null;
    status: string;
}

// Global state for our UI
let logsState: LogEntry[] = [];
let statusBarState: StatusBarData = {
    promptTokens: 0,
    promptCachedTokens: 0,
    totalTokens: 0,
    tokensPerSecond: 0,
    promptProcessingPerSecond: 0,
    currentlyRunningTool: null,
    model: null,
    status: 'Ready',
};

// Function to update status bar data
export const updateStatusBar = (data: Partial<StatusBarData>) => {
    statusBarState = { ...statusBarState, ...data };
};

let setText;
let _text = '';
// Function to add a log entry
export const addLog = (text: string) => {
    const newEntry: LogEntry = {
        id: Date.now(),
        text,
        timestamp: new Date(),
    };

    //setLogItems([...logsState, newEntry]);
    _text += text;
    setText(_text);
};

let setStatusText;
export const setStatusBarText = (text: string) => {
    setStatusText(text);
};

let setUser;
export const setUserInput = (text: string) => {
    setUser(text);
};

// Main Ink UI component
const InkTerminal = () => {
    const [terminalSize, setTerminalSize] = useState({});
    const [logItems, _setLogItems] = useState([]);
    const [userInput, _setUserInput] = useState([]);
    setUser = _setUserInput;
    const [statusBarText, _setStatusBarText] = useState([]);
    const [text, _setText] = useState([]);
    setStatusText = _setStatusBarText;
    setText = _setText;
    setLogItems = _setLogItems;
    const { focus } = useFocusManager();

    function getTerminalSize() {
        return {
            columns: process.stdout.columns || 80,
            rows: process.stdout.rows || 24,
        };
    }

    // Handle terminal resize events
    function setupResizeHandler() {
        // Listen for resize events
        process.stdout.on('resize', () => {
            setTerminalSize(getTerminalSize());
        });

        // Also listen for SIGWINCH signal (Unix/Linux)
        process.on('SIGWINCH', () => {
            setTerminalSize(getTerminalSize());
        });
    }
    useEffect(() => {
        focus('user');
        setTerminalSize(getTerminalSize());
        setupResizeHandler();
    }, []);

    // We'll use a fixed number of lines for the log area
    const maxLogLines = 20;

    // Get only the most recent log entries
    const visibleLogs = logsState.slice(-maxLogLines);

    // Format status bar text

    return (
        <Box
            flexDirection="column"
            flexGrow={1}
            width={terminalSize.columns}
            height={terminalSize.rows - 1}
        >
            <Box
                flexDirection="column"
                flexGrow={1}
                borderStyle="single"
                borderColor="blue"
                padding={1}
                overflow="hidden"
            >
                <Text>{text}</Text>
            </Box>
            <Box flexDirection="row" padding={1}></Box>
            <Text>User: {userInput}</Text>
            {/* Status bar - fixed at bottom */}
            <Box flexDirection="row">
                <Text>{statusBarText}</Text>
            </Box>
        </Box>
    );
};

export const initInkTerminal = () => {
    const inkInstance = render(<InkTerminal />);

    return () => {
        inkInstance.unmount();
    };
};
