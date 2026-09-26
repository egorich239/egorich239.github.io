default rel
;; stage0.asm - BFG stage0 self-compiler
;;
;; Parses hex bytes from ; comment lines, emits raw machine code.
;; Input: rdi = decode target, rsi = hex source -- the SysV registers
;; of stage0(output, input).
;; Terminator: NUL byte.
;; At exit: rsi rides past the NUL, rdi is the raw decode cursor, and
;; the ret consumes the image base parked at entry.

section .text
global stage0

FLAG_CODE   equ 0x01
FLAG_EMIT   equ 0x80

stage0:
    push rdi
    xor edx, edx                ;; oreg = 0
    xor ecx, ecx                ;; flags: 0x1=code; 0x2=output

.next_char:
    movzx eax, byte [rsi]       ;; read input
    inc rsi                     ;; and advance
    
    test al, al
    jz .done                    ;; leave on NUL

    cmp al, ';'
    jnz .not_semi
    xor cl, FLAG_CODE           ;; switch state on semicolon
    ;; fall through: does not affect the result,
    ;; saves one jmp instruction.

.not_semi:
    test cl, FLAG_CODE
    jz .next_char               ;; comment mode, skip.

    lea rax, [rax-0x30]         ;; c - '0'
    cmp al, 0x9
    ja .try_alpha
    shl edx, 4
    lea edx, [rdx+rax]
    jmp .got_digit

.try_alpha:
    lea rax, [rax-0x11]         ;; c - 'A'
    cmp al, 0x5
    ja .next_char
    shl edx, 4
    lea edx, [rdx+rax+10]       ;; c - 'A' + 10

.got_digit:
    xor cl, FLAG_EMIT           ;; flip emit flag
    js .next_char               ;; check sign
    mov [rdi], dl               ;; if it's ZERO - emit
    inc rdi
    jmp .next_char

.done:
    ret                         ;; jmp the image base parked at entry;
                                ;; rsi rides past the NUL, rdi is the
                                ;; decode cursor -- the hosted driver
                                ;; reads both from the fault this jmp
                                ;; takes on its RW- page
