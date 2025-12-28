export enum RoundStatus {
    PENDING = 0,
    ACTIVE = 1,
    CALCULATING = 2,
    FINALIZED = 3
}

export interface RoundInfo {
    status: number;
    endTime: bigint;
    totalPot: bigint;
    ticketsSold: bigint;
    participantCount: bigint;
}

export interface UserInfo {
    username: string;
    usdcBalance: bigint;
    sharesBalance: bigint;
}
