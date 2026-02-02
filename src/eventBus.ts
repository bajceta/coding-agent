import { EventEmitter } from 'events';

class EventBus extends EventEmitter {
    private static instance: EventBus;

    private constructor() {
        super();
    }

    public static getInstance(): EventBus {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }

    public on(eventName: string, listener: (...args: any[]) => void): this {
        return super.on(eventName, listener);
    }

    public once(eventName: string, listener: (...args: any[]) => void): this {
        return super.once(eventName, listener);
    }

    public off(eventName: string, listener: (...args: any[]) => void): this {
        return super.off(eventName, listener);
    }

    public emit(eventName: string, ...args: any[]): boolean {
        return super.emit(eventName, ...args);
    }
}

export default EventBus.getInstance();
