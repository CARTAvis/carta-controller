#!/bin/bash
# This script is a safe way to allow a user to kill specific commands of other users via sudo
COMMAND_TO_MATCH="carta_backend"

# The backend is started with sudo, and there may be multiple nested sudo processes,
# so we recursively search for a child process with the correct name.

# Start with the PID that was passed in
PID=$1

while : ; do
    # Get the command name of the process
    COMMAND_OF_PID=`ps -p $PID -o comm=`

    # If this is the backend process, try to kill it
    if [ "$COMMAND_OF_PID" == "$COMMAND_TO_MATCH" ]; then
        kill -9 $PID
        exit $?
    fi

    # Otherwise look for a child
    CHILD_PID=`pgrep -P $PID`

    # If there's no child, exit with an error
    if [ -z "${CHILD_PID}" ]; then
        echo "Could not find child process named $COMMAND_TO_MATCH."
        exit 1
    fi

    # Otherwise start over with the child process
    PID=$CHILD_PID
done
