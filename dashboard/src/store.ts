import { action, observable } from "mobx";

export class Store {
    @observable loggedIn: boolean;
    @observable username?: string;

    constructor() {
        this.loggedIn = false;
    }

    login = async (username: string, password: string) => {
        // Simulate delay
        await new Promise(f => setTimeout(f, 500));
        this.setLoggedIn(true);
    }

    logout = async () => {
        // Simulate delay
        await new Promise(f => setTimeout(f, 250));
        this.setLoggedIn(false);
    }

    @action setLoggedIn(val: boolean) {
        this.loggedIn = val;
    }
}