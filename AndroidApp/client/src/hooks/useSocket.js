import { useEffect } from 'react';
import socket, { connectSocket, disconnectSocket } from '../services/socket';

const useSocket = (event, callback) => {
    useEffect(() => {
        connectSocket();

        if (event && callback) {
            socket.on(event, callback);
        }

        return () => {
            if (event && callback) {
                socket.off(event, callback);
            }
        };
    }, [event, callback]);

    return socket;
};

export default useSocket;
