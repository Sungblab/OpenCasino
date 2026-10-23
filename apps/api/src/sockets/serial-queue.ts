/**
 * 넘겨받은 작업을 들어온 순서대로 하나씩 실행한다. 앞 작업이 실패해도 다음 작업은 실행된다.
 *
 * 소켓 하나의 방 입장·퇴장에 쓴다. 화면은 앱 전체에서 소켓 하나를 쓰므로 같은 방을 나갔다가
 * 곧바로 다시 들어오면(React 개발 모드의 두 번 마운트, 빠른 뒤로 가기) "퇴장, 입장" 이 연달아
 * 오는데, 핸들러가 비동기라 퇴장이 입장보다 늦게 끝나면 방금 들어온 사람을 빼 버렸다. 그러면 그
 * 사람의 베팅이 전부 ROOM_JOIN_REQUIRED 로 거절됐다.
 *
 * 예전에는 connection 핸들러 안에서 socket.on 을 몽키패치해 이름이 .join/.leave 로 끝나는
 * 이벤트를 몰래 줄 세웠다. 어떤 이벤트가 줄을 서는지 핸들러만 봐서는 알 수 없었고, socket.on 의
 * 동작을 바꾸는 전역 부작용이었다. 이제 줄 세우기가 필요한 핸들러가 이 큐를 명시적으로 쓴다.
 */
export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    // 실패한 작업이 줄 전체를 막지 않게, 다음 작업은 결과와 상관없이 이어 붙인다.
    tail = run.catch(() => undefined);
    return run;
  };
}
